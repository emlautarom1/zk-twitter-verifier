import { Provable, Struct, UInt32, UInt64 } from "o1js";

const Words64 = Provable.Array(UInt32, 64);

export class UInt2048 extends Struct({ words: Words64 }) {

  static zero() {
    return new UInt2048({ words: Array(64).fill(UInt32.zero) });
  }

  static fromHexString(hexString: string) {
    const wordSize = 8;
    const chars = hexString.split('')

    const prefix = chars.splice(0, 2).join('');
    if (prefix != '0x') {
      throw new Error("Hex string should be prefixed with `0x`");
    }

    const res = UInt2048.zero();
    for (let i = 1; i <= chars.length / wordSize; i++) {
      const offset = chars.length - (i * wordSize);
      const word = chars.slice(offset, offset + wordSize).join('');
      res.words[i - 1] = UInt32.from(`0x${word}`);
    }
    return res;
  }

  sub(other: UInt2048): UInt2048 {
    let res = UInt2048.zero();
    let borrow = UInt64.zero;
    for (let i = 0; i < 64; i++) {
      let minuend = this.words[i].toUInt64();
      // Instead of (-1) the minuend in case of borrow, we (+1) the substrahend as UInt64, avoiding underflows
      let substrahend = other.words[i].toUInt64().add(borrow);

      // In case the minuend is less than the substrahend, we have to borrow from the next word
      // If we borrow, we add 2^32 to the minuend
      borrow = Provable.if(minuend.lessThan(substrahend), UInt64.one, UInt64.zero);
      minuend = Provable.if(
        minuend.lessThan(substrahend),
        minuend.add(UInt64.from(4294967296 /* 2^32 */)),
        minuend);

      // Perform the subtraction, where no underflow can happen
      res.words[i] = minuend.sub(substrahend).toUInt32();
    }

    return res;
  }

  mul(other: UInt2048): UInt2048 {
    let result: UInt2048 = UInt2048.zero();

    for (let j = 0; j < 64; j++) {
      let carry: UInt64 = new UInt64(0);
      for (let i = 0; i + j < 64; i++) {
        // Perform the multiplication in UInt64 to ensure that the result always fits (no overflow here)
        let product: UInt64 = this.words[i].toUInt64()
          .mul(other.words[j].toUInt64())
          // Add the previous result for this word index
          .add(result.words[i + j].toUInt64())
          // Lastly, add the previous carry
          .add(carry);

        let { quotient: highBits, rest: lowBits } = product.divMod(UInt64.from(4294967296 /* 2^32 */));
        // Keep only the value that fits in a UInt32 (the low bits)
        result.words[i + j] = lowBits.toUInt32();
        // Extract the carry from the product by keeping the bits that could not fit in a UInt32 (the high bits).
        // This carry will be used in the next iteration
        carry = highBits;
      }
    }

    return result;
  }
}

describe("BigInt", () => {
  it('substracts', () => {
    let a = UInt2048.fromHexString("0xFFFFFFFFBBBBBBBB");
    let b = UInt2048.fromHexString("0xCCCCCCCCAAAAAAAA");

    let res = a.sub(b);
    expect(res.words[0].toBigint()).toBe(BigInt("0x11111111"));
    expect(res.words[1].toBigint()).toBe(BigInt("0x33333333"));
    for (let i = 2; i < res.words.length; i++) {
      const word = res.words[i];
      expect(word.toBigint()).toBe(0n);
    }
  })

  it('substracts with underflow', () => {
    let a = UInt2048.fromHexString("0xAAAAAAAABBBBBBBB");
    let b = UInt2048.fromHexString("0xCCCCCCCCAAAAAAAA");

    let res = a.sub(b);
    expect(res.words[0].toBigint()).toBe(BigInt("0x11111111"));
    expect(res.words[1].toBigint()).toBe(BigInt("0xDDDDDDDE"));
    for (let i = 2; i < res.words.length; i++) {
      const word = res.words[i];
      expect(word.toBigint()).toBe(BigInt("0xFFFFFFFF"));
    }
  })

  it('substracts to 0', () => {
    let a = UInt2048.zero();
    let b = UInt2048.fromHexString("0xAAAAAAAA");

    let res = a.sub(b);
    expect(res.words[0].toBigint()).toBe(BigInt("0x55555556"));
    for (let i = 1; i < res.words.length; i++) {
      const word = res.words[i];
      expect(word.toBigint()).toBe(BigInt("0xFFFFFFFF"))
    }
  })

  it('multiplies', () => {
    let a = UInt2048.fromHexString("0xFFFFFFFFAAAAAAAA");
    let b = UInt2048.fromHexString("0xEEEEEEEEBBBBBBBB");

    let res = a.mul(b)
    expect(res.words[0].toBigint()).toBe(BigInt("0x2D82D82E"));
    expect(res.words[1].toBigint()).toBe(BigInt("0xCCCCCCCD"));
    expect(res.words[2].toBigint()).toBe(BigInt("0x6C16C16A"));
    expect(res.words[3].toBigint()).toBe(BigInt("0xEEEEEEEE"));
    for (let i = 4; i < res.words.length; i++) {
      const word = res.words[i];
      expect(word.toBigint()).toBe(0n);
    }
  })
});
