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
}

describe("BigInt JS", () => {

  it("substracts", () => {
    let a = UInt2048.fromBigInt(0xFFFFFFFFFFFFFFFFBBBBBBBBBBBBBBBBn);
    let b = UInt2048.fromBigInt(0xCCCCCCCCCCCCCCCCAAAAAAAAAAAAAAAAn);

    let res = a.sub(b);

    expect(res.words[0].toBigInt()).toBe(0x1111111111111111n);
    expect(res.words[1].toBigInt()).toBe(0x3333333333333333n);
    for (let i = 2; i < res.words.length; i++) {
      const word = res.words[i];
      expect(word.toBigInt()).toBe(0n);
    }
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
      expect(word.toBigInt()).toBe(0xFFFFFFFFFFFFFFFFn)
    }
  });

  it("multiplies", () => {
    let a = UInt2048.fromBigInt(0xFFFFFFFFFFFFFFFFAAAAAAAAAAAAAAAAn);
    let b = UInt2048.fromBigInt(0xEEEEEEEEEEEEEEEEBBBBBBBBBBBBBBBBn);

    let res = a.mul(b);

    expect(res.words[0].toBigInt()).toBe(0xD82D82D82D82D82En);
    expect(res.words[1].toBigInt()).toBe(0x7777777777777777n);
    expect(res.words[2].toBigInt()).toBe(0x6C16C16C16C16C15n);
    expect(res.words[3].toBigInt()).toBe(0xEEEEEEEEEEEEEEEEn);
    for (let i = 4; i < res.words.length; i++) {
      const word = res.words[i];
      expect(word.toBigInt()).toBe(0n);
    }
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
  }
})

describe("BigInt ZK", () => {
  beforeAll(async () => {
    let analysis = TestProgram.analyzeMethods();
    console.log({"subtract": analysis.subtract.rows, "multiply": analysis.multiply.rows });
    await TestProgram.compile();
  })

  it("substracts", async () => {
    let a = UInt2048.fromBigInt(0xFFFFFFFFFFFFFFFFBBBBBBBBBBBBBBBBn);
    let b = UInt2048.fromBigInt(0xCCCCCCCCCCCCCCCCAAAAAAAAAAAAAAAAn);

    let proof = await TestProgram.subtract(a, b);
    proof.verify();
    let res = proof.publicOutput;

    expect(res.words[0].toBigInt()).toBe(0x1111111111111111n);
    expect(res.words[1].toBigInt()).toBe(0x3333333333333333n);
    for (let i = 2; i < res.words.length; i++) {
      const word = res.words[i];
      expect(word.toBigInt()).toBe(0n);
    }
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
      expect(word.toBigInt()).toBe(0xFFFFFFFFFFFFFFFFn)
    }
  });

  it("multiplies", async () => {
    let a = UInt2048.fromBigInt(0xFFFFFFFFFFFFFFFFAAAAAAAAAAAAAAAAn);
    let b = UInt2048.fromBigInt(0xEEEEEEEEEEEEEEEEBBBBBBBBBBBBBBBBn);

    let proof = await TestProgram.multiply(a, b);
    proof.verify();
    let res = proof.publicOutput;

    expect(res.words[0].toBigInt()).toBe(0xD82D82D82D82D82En);
    expect(res.words[1].toBigInt()).toBe(0x7777777777777777n);
    expect(res.words[2].toBigInt()).toBe(0x6C16C16C16C16C15n);
    expect(res.words[3].toBigInt()).toBe(0xEEEEEEEEEEEEEEEEn);
    for (let i = 4; i < res.words.length; i++) {
      const word = res.words[i];
      expect(word.toBigInt()).toBe(0n);
    }
  });
})
