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

  it("multiplies in modulo", () => {
    let a = UInt2048.fromBigInt(0xFFFFFFFFFFFFFFFFAAAAAAAAAAAAAAAAn);
    let b = UInt2048.fromBigInt(0xEEEEEEEEEEEEEEEEBBBBBBBBBBBBBBBBn);
    let m = UInt2048.fromBigInt(0xAAAAAAAAAAAAAAAACCCCCCCCCCCCCCCCn);

    let res = a.mulMod(b, m);

    expect(res.toBigInt()).toBe(0x67FE2DF75A56ED1C86F0C0F7949801D2n);
  });

  it("squares in modulo (large)", () => {
    let x = UInt2048.fromBigInt(7399263291253486377490857555628088504903225526918433583280177751067626055076666305833747883216962529337349803752979501294683304474370330741958729390769363319160981420068875792061874516105822986719289365790407917272330747131021488336597119198244031463224940831975388999146344712685805172014882867969225268188089769271042384775956340478854064226334891202230166163919487243153541038300242921449669686540810432905615160996581136973563427950347395768036800813960003662717811614486129048241814405624467320003723428112674092851981222974880580795892163220718983415073820782360302741826739956003397078138558270734482658400051n);
    let m =
    UInt2048.fromBigInt(21032419005188773477160160703111727600972139666814266494859331063821851059524649576504104661540213326442045972788391364192242525175255107247932255841994065836751895197538109047954942591653291704156057152250244018857428601559847113057161956761903434329018039409239682021229136090772832598400866750032021634823574047683920850290115383610162035365846459261860084073819704796606493797761646798169026019572592022957610553186380489823598676408337606339163861795568282904694834160431699922527471511202471035735767658055495019581592965117235572375885540588764243186378456248194415996343099520967557674426101901833971963027377n);

    let res = x.mulMod(x, m);

    expect(res.toBigInt()).toBe(0x7B7396032720D9A75AAA881CB9109880D13565CA9197A9F1E2C6EAC3668FEFAB327F241D3C96FDAD5AC83291286A47C14CB55D489092F52EC5D35F939A73DEFA75037BC42506302921C31255EC8C643AFF2FDE5EB853CE55E74ECB430E4B9BBD9C2C974C5D5C9795C6E93B98E828BAE9B459643EB8FBC11D4CE527E3830C75477CE4D9FBABA7A96FFE881DC49009A1DC005BBA03720F96E481D3B8946B290A98ABE8CFEB2E42BC9185C959C2D58F66A931C6772CC9816EF66974DE910111728A369887D9BFD94B2F818187C73BB09F619CB3AECE98742F9AE768FF73A446615BA9E1466B767AA922366ECAA4B231DBC7CB97C728385C762BB2E4650BEE4B3429n);
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
