import { Field, Provable, Struct } from "o1js";

// We'll use each `Field` as a `UInt64`, meaning that we need 32 `Field`s to represent a `UInt2048`
const DoubleWord32 = Provable.Array(Field, 32);

export class UInt2048 extends Struct({ words: DoubleWord32 }) {

  static zero() {
    return new UInt2048({ words: Array(32).fill(Field.from(0)) });
  }

  static fromHexString(hexString: string) {
    const wordSize = 16;
    const chars = hexString.split("")

    const prefix = chars.splice(0, 2).join("");
    if (prefix != "0x") {
      throw new Error("Hex string should be prefixed with `0x`");
    }

    const res = UInt2048.zero();
    for (let i = 1; i <= chars.length / wordSize; i++) {
      const offset = chars.length - (i * wordSize);
      const word = chars.slice(offset, offset + wordSize).join("");
      res.words[i - 1] = Field.from(`0x${word}`);
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
      borrow = Provable.if(minuend.lessThan(substrahend), Field.from(1), Field.from(0));
      minuend = Provable.if(
        minuend.lessThan(substrahend),
        minuend.add(Field.from(18446744073709551616n /* 2^64 */ )),
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

        // We don't have access to your typicall masking and shifting operations,
        // so in order to extract the low and high bits we'll use the bit array representation.
        let bits = product.toBits(128);
        let lowBits = Field.fromBits(bits.slice(0, 64));
        let highBits = Field.fromBits(bits.slice(64, 128));

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
    let a = UInt2048.fromHexString("0xFFFFFFFFFFFFFFFFBBBBBBBBBBBBBBBB");
    let b = UInt2048.fromHexString("0xCCCCCCCCCCCCCCCCAAAAAAAAAAAAAAAA");

    let res = a.sub(b);

    expect(res.words[0].toBigInt()).toBe(0x1111111111111111n);
    expect(res.words[1].toBigInt()).toBe(0x3333333333333333n);
    for (let i = 2; i < res.words.length; i++) {
      const word = res.words[i];
      expect(word.toBigInt()).toBe(0n);
    }
  });

  it("substracts with underflow", async () => {
    let a = UInt2048.fromHexString("0xAAAAAAAAAAAAAAAABBBBBBBBBBBBBBBB");
    let b = UInt2048.fromHexString("0xCCCCCCCCCCCCCCCCAAAAAAAAAAAAAAAA");

    let res = a.sub(b);

    expect(res.words[0].toBigInt()).toBe(0x1111111111111111n);
    expect(res.words[1].toBigInt()).toBe(0xDDDDDDDDDDDDDDDEn);

    for (let i = 2; i < res.words.length; i++) {
      const word = res.words[i];
      expect(word.toBigInt()).toBe(0xFFFFFFFFFFFFFFFFn);
    }
  });

  it("substracts to 0", async () => {
    let a = UInt2048.zero();
    let b = UInt2048.fromHexString("0xAAAAAAAAAAAAAAAA");

    let res = a.sub(b);

    expect(res.words[0].toBigInt()).toBe(0x5555555555555556n);
    for (let i = 1; i < res.words.length; i++) {
      const word = res.words[i];
      expect(word.toBigInt()).toBe(0xFFFFFFFFFFFFFFFFn)
    }
  });

  // it("multiplies", () => {
  //   let a = UInt2048.fromHexString("0xFFFFFFFFAAAAAAAA");
  //   let b = UInt2048.fromHexString("0xEEEEEEEEBBBBBBBB");

  //   let res = a.mul(b);

  //   expect(res.words[0].toBigInt()).toBe(BigInt("0x2D82D82E"));
  //   expect(res.words[1].toBigInt()).toBe(BigInt("0xCCCCCCCD"));
  //   expect(res.words[2].toBigInt()).toBe(BigInt("0x6C16C16A"));
  //   expect(res.words[3].toBigInt()).toBe(BigInt("0xEEEEEEEE"));
  //   for (let i = 4; i < res.words.length; i++) {
  //     const word = res.words[i];
  //     expect(word.toBigInt()).toBe(0n);
  //   }
  // });
});
