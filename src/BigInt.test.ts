import { Field, Provable, Struct, ZkProgram } from "o1js";
import { provableTuple } from "o1js/dist/node/lib/circuit_value";

const Gadgets = {
  divMod64: (n: Field) => {
    let [quotient, remainder] = Provable.witness(
      provableTuple([Field, Field]),
      () => {
        let nBigInt = n.toBigInt();
        let q = nBigInt >> 64n;
        let r = nBigInt - (q << 64n /* 2^64 */);
        return [new Field(q), new Field(r)];
      }
    );

    n.assertEquals(quotient.mul(1n << 64n).add(remainder));

    return { quotient, remainder };
  }
}

// We'll use each `Field` as a `UInt64`, meaning that we need 32 `Field`s to represent a `UInt2048`
// TODO: A possible optimization is to use a custom power of 2 given that a Field can be at most 2^254
// For example, each "word" could be <= 2^127, such that multiplication never overflows
// With this, we would need an array of 17 elements instead of 32
const DoubleWord32 = Provable.Array(Field, 32);

export class UInt2048 extends Struct({ words: DoubleWord32 }) {

  static zero() {
    return new UInt2048({ words: Array(32).fill(Field.from(0)) });
  }

  static fromBigInt(bigInt: bigint) {
    const res = UInt2048.zero();
    for (let i = 0; i < 32; i++) {
      res.words[i] = Field.from(bigInt & 0xFFFFFFFFFFFFFFFFn);
      bigInt >>= 64n;
    }
    return res;
  }

  toBigInt(): bigint {
    let res = 0n;
    for (let i = 0; i < 32; i++) {
      let word = this.words[i].toBigInt();
      res += word << (64n * BigInt(i));
    }
    return res;
  }

  sub(other: UInt2048): UInt2048 {
    let res = UInt2048.zero();
    let borrow = Field.from(0);
    for (let i = 0; i < 32; i++) {
      let minuend = this.words[i];
      // Instead of (-1) the minuend in case of borrow, we (+1) the substrahend, avoiding underflows
      // Overflows can't happen either due to the subtrahend being at most (2^64 - 1)
      let substrahend = other.words[i].add(borrow);

      // In case the minuend is less than the substrahend, we have to borrow from the next word
      // If we borrow, we add 2^64 to the minuend
      let requiresBorrow = minuend.lessThan(substrahend);
      borrow = Provable.if(
        requiresBorrow,
        Field.from(1),
        Field.from(0));
      minuend = Provable.if(
        requiresBorrow,
        minuend.add(Field.from(1n << 64n /* 2^64*/)),
        minuend);

      // Perform the subtraction, where no underflow can happen
      res.words[i] = minuend.sub(substrahend);
    }

    return res;
  }

  mul(other: UInt2048): UInt2048 {
    let result: UInt2048 = UInt2048.zero();

    for (let j = 0; j < 32; j++) {
      let carry = Field.from(0);
      for (let i = 0; i + j < 32; i++) {
        // Perform the multiplication in UInt64 to ensure that the result always fits (no overflow here)
        let product: Field = this.words[i]
          .mul(other.words[j])
          // Add the previous result for this word index
          .add(result.words[i + j])
          // Lastly, add the previous carry
          .add(carry);

        let { remainder: lowBits, quotient: highBits } = Gadgets.divMod64(product);
        // Keep only the value that fits in a UInt64 (the low bits)
        result.words[i + j] = lowBits;
        // Extract the carry from the product by keeping the bits that could not fit in a UInt64 (the high bits).
        // This carry will be used in the next iteration
        carry = highBits;
      }
    }

    return result;
  }

  mulMod(other: UInt2048, modulus: UInt2048): UInt2048 {
    let x = this;
    let y = other
    let m = modulus;

    // (x * y) = (q * m) + r
    // (x * y) - (q * m) = r
    // r_ = (x * y) - (q * m) => r_ = r
    let { q, r } = Provable.witness(Struct({ q: UInt2048, r: UInt2048 }), () => {
      let xy = x.toBigInt() * y.toBigInt() % (1n << 2048n);
      let q = xy / m.toBigInt();
      let r = xy % m.toBigInt();

      return { q: UInt2048.fromBigInt(q), r: UInt2048.fromBigInt(r) };
    });


    let xy = x.mul(y);
    let qm = q.mul(m);
    let r_ = xy.sub(qm);
    Provable.assertEqual(UInt2048, r_, r);

    return r;
  }
}

describe("BigInt JS", () => {

  it("substracts", () => {
    let a = UInt2048.fromBigInt(0xFFFFFFFFFFFFFFFFBBBBBBBBBBBBBBBBn);
    let b = UInt2048.fromBigInt(0xCCCCCCCCCCCCCCCCAAAAAAAAAAAAAAAAn);

    let res = a.sub(b);

    expect(res.toBigInt()).toBe(0x33333333333333331111111111111111n);
  });

  it("substracts with underflow", () => {
    let a = UInt2048.fromBigInt(0xAAAAAAAAAAAAAAAABBBBBBBBBBBBBBBBn);
    let b = UInt2048.fromBigInt(0xCCCCCCCCCCCCCCCCAAAAAAAAAAAAAAAAn);

    let res = a.sub(b);

    expect(res.words[0].toBigInt()).toBe(0x1111111111111111n);
    expect(res.words[1].toBigInt()).toBe(0xDDDDDDDDDDDDDDDEn);
    for (let i = 2; i < res.words.length; i++) {
      const word = res.words[i];
      expect(word.toBigInt()).toBe(0xFFFFFFFFFFFFFFFFn);
    }
  });

  it("substracts to 0", () => {
    let a = UInt2048.zero();
    let b = UInt2048.fromBigInt(0xAAAAAAAAAAAAAAAAn);

    let res = a.sub(b);

    expect(res.words[0].toBigInt()).toBe(0x5555555555555556n);
    for (let i = 1; i < res.words.length; i++) {
      const word = res.words[i];
      expect(word.toBigInt()).toBe(0xFFFFFFFFFFFFFFFFn);
    }
  });

  it("multiplies", () => {
    let a = UInt2048.fromBigInt(0xFFFFFFFFFFFFFFFFAAAAAAAAAAAAAAAAn);
    let b = UInt2048.fromBigInt(0xEEEEEEEEEEEEEEEEBBBBBBBBBBBBBBBBn);

    let res = a.mul(b);

    expect(res.toBigInt()).toBe(0xEEEEEEEEEEEEEEEE6C16C16C16C16C157777777777777777D82D82D82D82D82En);
  });

  it("squares (large)", () => {
    let x = UInt2048.fromBigInt(0x3A9D0B6E2F575372AFD014CD788B7C06F13190B6A15B7F46EE4DEF122B001C92FA33150C5EAB0B045096467B9573363630187880500645EDEC06AAAE8CD6447796AF95C499C14AE86684B56B52B2D389D6DAA852ED1835E0AB821361E8BE1BA3CEEBBB009DB1C1CF07D3BD63AD4ACEFB5B06E3DF55DC9FA47DC1EDDF0C4E128A7A7EF30CB13E7F8C7E0D6A2EDCB1FBF2130707532E84330750E23A3DF0EB3A8298BA36DB132357DEB933B6971FD78116B782EB6F8AC5B85B31D6ACCA4153230A492397E65DB45E9FD8A6E5E0BF0B255FCD636DD3F07FCAA11DC0A0BD13136F57AC6CFACC210BCE875C51980A1C00FE3B1ED245D28FB4EF46FCF6C9F64F859733n);

    let res = x.mul(x);

    expect(res.toBigInt()).toBe(0x7B7396032720D9A75AAA881CB9109880D13565CA9197A9F1E2C6EAC3668FEFAB327F241D3C96FDAD5AC83291286A47C14CB55D489092F52EC5D35F939A73DEFA75037BC42506302921C31255EC8C643AFF2FDE5EB853CE55E74ECB430E4B9BBD9C2C974C5D5C9795C6E93B98E828BAE9B459643EB8FBC11D4CE527E3830C75477CE4D9FBABA7A96FFE881DC49009A1DC005BBA03720F96E481D3B8946B290A98ABE8CFEB2E42BC9185C959C2D58F66A931C6772CC9816EF66974DE910111728A369887D9BFD94B2F818187C73BB09F619CB3AECE98742F9AE768FF73A446615BA9E1466B767AA922366ECAA4B231DBC7CB97C728385C762BB2E4650BEE4B3429n);
  });

  it("multiplies in modulo", () => {
    let a = UInt2048.fromBigInt(0xFFFFFFFFFFFFFFFFAAAAAAAAAAAAAAAAn);
    let b = UInt2048.fromBigInt(0xEEEEEEEEEEEEEEEEBBBBBBBBBBBBBBBBn);
    let m = UInt2048.fromBigInt(0xAAAAAAAAAAAAAAAACCCCCCCCCCCCCCCCn);

    let res = a.mulMod(b, m);

    expect(res.toBigInt()).toBe(0x67FE2DF75A56ED1C86F0C0F7949801D2n);
  });

  it("squares in modulo (large)", () => {
    let x = UInt2048.fromBigInt(0x7B7396032720D9A75AAA881CB9109880D13565CA9197A9F1E2C6EAC3668FEFAB327F241D3C96FDAD5AC83291286A47C14CB55D489092F52EC5D35F939A73DEFA75037BC42506302921C31255EC8C643AFF2FDE5EB853CE55E74ECB430E4B9BBD9C2C974C5D5C9795C6E93B98E828BAE9B459643EB8FBC11D4CE527E3830C75477CE4D9FBABA7A96FFE881DC49009A1DC005BBA03720F96E481D3B8946B290A98ABE8CFEB2E42BC9185C959C2D58F66A931C6772CC9816EF66974DE910111728A369887D9BFD94B2F818187C73BB09F619CB3AECE98742F9AE768FF73A446615BA9E1466B767AA922366ECAA4B231DBC7CB97C728385C762BB2E4650BEE4B3429n);
    let m = UInt2048.fromBigInt(0xA69BDDB10F2AB9EECC06C1D817464D63E4C449C8430E47DD2402D65FE329A4214E2C090F582149EB80E90580B767AD5210AF0A746448877FD356C8EA0D0C32CD15164858F85C8F98BE9F96B9F76E507881B19437E2E53069CA3895916C797AA144895467A4CAE66DCE995782CF6E40EFDCB87B528C31D17CEF0C223B3A42F1534CF3AA6AB72696A364E0D1C1EE02DD00248C653797EB7E799F880ABB21969BE957178B4CA1A82690078E9D730853BFE3881C5D773E41ED5A0B28C440B7DC625C229A3F39F56A2898871911E6D2424846E54A7FF61912A635BF746BC0D5E2CDD3716DEC51AFB5D232D59C163B8472FA6376C23E8D47DFE0F1A139385C13F05FB1n);

    let res = x.mulMod(x, m);

    expect(res.toBigInt()).toBe(0x40FAEC038597C696CBFFCB086C858AE2ACC5EAB7A4A2361625B44BCD132AF449D03607867FA51063ADE803C0E2F5AAAA30E7B70AB922776391249DD3B7A998447C618E6175EB918D0119CD3344989087FAC565A8755DEA5DED5AA7BD06FCE784B6E4A09359EC6802B3BCF8C313AFA90690A25FE28354E15C9A576360D892C2E59EAC5885D80193DE85C4CF17E4A89EA0E47696EB3D859D1473B77EF4BA39E15626F264157F27FF4360E159E8B7050B7E0D80F372B98DB4B4030F58F857BABC2066F9E974AA20EF3B91AABBC808FB61009D37C583BDE8E6AC74F496989DD9306D358A433E164A3B0F907D766FFC1795BC75EB531A4374E5E7FB3D883DC2B64EE0n);
  });
});

// ZK-Program tests

let TestProgram = ZkProgram({
  name: "TestProgram",
  publicOutput: UInt2048,
  methods: {
    subtract: {
      privateInputs: [UInt2048, UInt2048],
      method(a: UInt2048, b: UInt2048): UInt2048 {
        return a.sub(b);
      }
    },
    multiply: {
      privateInputs: [UInt2048, UInt2048],
      method(a: UInt2048, b: UInt2048): UInt2048 {
        return a.mul(b);
      }
    },
    multiplyMod: {
      privateInputs: [UInt2048, UInt2048, UInt2048],
      method(a: UInt2048, b: UInt2048, m: UInt2048): UInt2048 {
        return a.mulMod(b, m);
      }
    },
  }
})

describe("BigInt ZK", () => {
  beforeAll(async () => {
    let analysis = TestProgram.analyzeMethods();
    console.log({
      "subtract": analysis.subtract.rows,
      "multiply": analysis.multiply.rows,
      "multiplyMod": analysis.multiplyMod.rows,
    });
    await TestProgram.compile();
  })

  it("substracts", async () => {
    let a = UInt2048.fromBigInt(0xFFFFFFFFFFFFFFFFBBBBBBBBBBBBBBBBn);
    let b = UInt2048.fromBigInt(0xCCCCCCCCCCCCCCCCAAAAAAAAAAAAAAAAn);

    let proof = await TestProgram.subtract(a, b);
    proof.verify();
    let res = proof.publicOutput;

    expect(res.toBigInt()).toBe(0x33333333333333331111111111111111n);
  });

  it("substracts with underflow", async () => {
    let a = UInt2048.fromBigInt(0xAAAAAAAAAAAAAAAABBBBBBBBBBBBBBBBn);
    let b = UInt2048.fromBigInt(0xCCCCCCCCCCCCCCCCAAAAAAAAAAAAAAAAn);

    let proof = await TestProgram.subtract(a, b);
    proof.verify();
    let res = proof.publicOutput;

    expect(res.words[0].toBigInt()).toBe(0x1111111111111111n);
    expect(res.words[1].toBigInt()).toBe(0xDDDDDDDDDDDDDDDEn);
    for (let i = 2; i < res.words.length; i++) {
      const word = res.words[i];
      expect(word.toBigInt()).toBe(0xFFFFFFFFFFFFFFFFn);
    }
  });

  it("substracts to 0", async () => {
    let a = UInt2048.zero();
    let b = UInt2048.fromBigInt(0xAAAAAAAAAAAAAAAAn);

    let proof = await TestProgram.subtract(a, b);
    proof.verify();
    let res = proof.publicOutput;

    expect(res.words[0].toBigInt()).toBe(0x5555555555555556n);
    for (let i = 1; i < res.words.length; i++) {
      const word = res.words[i];
      expect(word.toBigInt()).toBe(0xFFFFFFFFFFFFFFFFn);
    }
  });

  it("multiplies", async () => {
    let a = UInt2048.fromBigInt(0xFFFFFFFFFFFFFFFFAAAAAAAAAAAAAAAAn);
    let b = UInt2048.fromBigInt(0xEEEEEEEEEEEEEEEEBBBBBBBBBBBBBBBBn);

    let proof = await TestProgram.multiply(a, b);
    proof.verify();
    let res = proof.publicOutput;

    expect(res.toBigInt()).toBe(0xEEEEEEEEEEEEEEEE6C16C16C16C16C157777777777777777D82D82D82D82D82En);
  });

  it("multiplies in modulo", async () => {
    let a = UInt2048.fromBigInt(0xFFFFFFFFFFFFFFFFAAAAAAAAAAAAAAAAn);
    let b = UInt2048.fromBigInt(0xEEEEEEEEEEEEEEEEBBBBBBBBBBBBBBBBn);
    let m = UInt2048.fromBigInt(0xAAAAAAAAAAAAAAAACCCCCCCCCCCCCCCCn);

    let proof = await TestProgram.multiplyMod(a, b, m);
    proof.verify();
    let res = proof.publicOutput;

    expect(res.toBigInt()).toBe(0x67FE2DF75A56ED1C86F0C0F7949801D2n);
  });
})
