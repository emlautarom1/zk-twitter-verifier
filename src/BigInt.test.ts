import {
  AccountUpdate,
   Field,
   Mina,
   PrivateKey,
   Provable,
   PublicKey,
   SmartContract,
   Struct,
   method
} from "o1js";

// We'll use each `Field` as a `UInt32`, meaning that we need 64 `Field`s to represent a `UInt2048`
const Words64 = Provable.Array(Field, 64);

export class UInt2048 extends Struct({ words: Words64 }) {

  static zero() {
    return new UInt2048({ words: Array(64).fill(Field.from(0)) });
  }

  static fromHexString(hexString: string) {
    const wordSize = 8;
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
    for (let i = 0; i < 64; i++) {
      let minuend = this.words[i];
      // Instead of (-1) the minuend in case of borrow, we (+1) the substrahend, avoiding underflows
      // Overflows can't happen either due to the subtrahend being at most (2^32 - 1)
      let substrahend = other.words[i].add(borrow);

      // In case the minuend is less than the substrahend, we have to borrow from the next word
      // If we borrow, we add 2^32 to the minuend
      borrow = Provable.if(minuend.lessThan(substrahend), Field.from(1), Field.from(0));
      minuend = Provable.if(
        minuend.lessThan(substrahend),
        minuend.add(Field.from(4294967296 /* 2^32 */)),
        minuend);

      // Perform the subtraction, where no underflow can happen
      res.words[i] = minuend.sub(substrahend);
    }

    return res;
  }

  mul(other: UInt2048): UInt2048 {
    let result: UInt2048 = UInt2048.zero();

    for (let j = 0; j < 64; j++) {
      let carry = Field.from(0);
      for (let i = 0; i + j < 64; i++) {
        // Perform the multiplication in UInt64 to ensure that the result always fits (no overflow here)
        let product: Field = this.words[i]
          .mul(other.words[j])
          // Add the previous result for this word index
          .add(result.words[i + j])
          // Lastly, add the previous carry
          .add(carry);

        // We don't have access to your typicall masking and shifting operations,
        // so in order to extract the low and high bits we'll use the bit array representation.
        let bits = product.toBits(64);
        let lowBits = Field.fromBits(bits.slice(0, 32));
        let highBits = Field.fromBits(bits.slice(32, 64));

        // Keep only the value that fits in a UInt32 (the low bits)
        result.words[i + j] = lowBits;
        // Extract the carry from the product by keeping the bits that could not fit in a UInt32 (the high bits).
        // This carry will be used in the next iteration
        carry = highBits;
      }
    }

    return result;
  }
}

export class TestContract extends SmartContract {
  @method sub(a: UInt2048, b: UInt2048): UInt2048 {
    return a.sub(b);
  }

  @method mul(a: UInt2048, b: UInt2048): UInt2048 {
    return a.mul(b);
  }
}

describe("BigInt", () => {
  let deployerAccount: PublicKey;
  let deployerKey: PrivateKey;

  let user_Account: PublicKey;
  let user_Key: PrivateKey;

  let zkAppAddress: PublicKey;
  let zkAppPrivateKey: PrivateKey;
  let zkApp: TestContract;

  beforeAll(async () => {
    TestContract.analyzeMethods();
    await TestContract.compile();
  });

  beforeEach(() => {
    const Local = Mina.LocalBlockchain({ proofsEnabled: true });
    Mina.setActiveInstance(Local);
    ({ privateKey: deployerKey, publicKey: deployerAccount } = Local.testAccounts[0]);
    ({ privateKey: user_Key, publicKey: user_Account } = Local.testAccounts[1]);
    zkAppPrivateKey = PrivateKey.random();
    zkAppAddress = zkAppPrivateKey.toPublicKey();
    zkApp = new TestContract(zkAppAddress);
  });

  async function localDeploy() {
    const txn = await Mina.transaction(deployerAccount, () => {
      AccountUpdate.fundNewAccount(deployerAccount);
      zkApp.deploy();
    });
    await txn.prove();
    await txn.sign([deployerKey, zkAppPrivateKey]).send();
  }

  it.only("substracts", async () => {
    await localDeploy();

    let a = UInt2048.fromHexString("0xFFFFFFFFBBBBBBBB");
    let b = UInt2048.fromHexString("0xCCCCCCCCAAAAAAAA");

    let res!: UInt2048;
    let retrieve = await Mina.transaction(user_Account, () => {
      res = zkApp.sub(a, b);
    });
    await retrieve.prove();
    await retrieve.sign([user_Key]).send();

    expect(res.words[0].toBigInt()).toBe(BigInt("0x11111111"));
    expect(res.words[1].toBigInt()).toBe(BigInt("0x33333333"));
    for (let i = 2; i < res.words.length; i++) {
      const word = res.words[i];
      expect(word.toBigInt()).toBe(0n);
    }
  });

  it("substracts with underflow", async () => {
    await localDeploy();

    let a = UInt2048.fromHexString("0xAAAAAAAABBBBBBBB");
    let b = UInt2048.fromHexString("0xCCCCCCCCAAAAAAAA");

    let res!: UInt2048;
    let retrieve = await Mina.transaction(user_Account, () => {
      res = zkApp.sub(a, b);
    });
    await retrieve.prove();
    await retrieve.sign([user_Key]).send();

    expect(res.words[0].toBigInt()).toBe(BigInt("0x11111111"));
    expect(res.words[1].toBigInt()).toBe(BigInt("0xDDDDDDDE"));
    for (let i = 2; i < res.words.length; i++) {
      const word = res.words[i];
      expect(word.toBigInt()).toBe(BigInt("0xFFFFFFFF"));
    }
  });

  it("substracts to 0", async () => {
    await localDeploy();

    let a = UInt2048.zero();
    let b = UInt2048.fromHexString("0xAAAAAAAA");

    let res!: UInt2048;
    let retrieve = await Mina.transaction(user_Account, () => {
      res = zkApp.sub(a, b);
    });
    await retrieve.prove();
    await retrieve.sign([user_Key]).send();

    expect(res.words[0].toBigInt()).toBe(BigInt("0x55555556"));
    for (let i = 1; i < res.words.length; i++) {
      const word = res.words[i];
      expect(word.toBigInt()).toBe(BigInt("0xFFFFFFFF"))
    }
  });

  // Disabled until we can figure out why this produces OOM
  // See: https://github.com/o1-labs/o1js/issues/1391
  xit("multiplies", async () => {
    await localDeploy();

    let a = UInt2048.fromHexString("0xFFFFFFFFAAAAAAAA");
    let b = UInt2048.fromHexString("0xEEEEEEEEBBBBBBBB");

    let res!: UInt2048;
    let retrieve = await Mina.transaction(user_Account, () => {
      res = zkApp.mul(a, b);
    });
    await retrieve.prove();
    await retrieve.sign([user_Key]).send();

    expect(res.words[0].toBigInt()).toBe(BigInt("0x2D82D82E"));
    expect(res.words[1].toBigInt()).toBe(BigInt("0xCCCCCCCD"));
    expect(res.words[2].toBigInt()).toBe(BigInt("0x6C16C16A"));
    expect(res.words[3].toBigInt()).toBe(BigInt("0xEEEEEEEE"));
    for (let i = 4; i < res.words.length; i++) {
      const word = res.words[i];
      expect(word.toBigInt()).toBe(0n);
    }
  });
});

describe("BigInt JS", () => {
  it("multiplies", async () => {
    let a = UInt2048.fromHexString("0xFFFFFFFFAAAAAAAA");
    let b = UInt2048.fromHexString("0xEEEEEEEEBBBBBBBB");

    let res = a.mul(b);

    expect(res.words[0].toBigInt()).toBe(BigInt("0x2D82D82E"));
    expect(res.words[1].toBigInt()).toBe(BigInt("0xCCCCCCCD"));
    expect(res.words[2].toBigInt()).toBe(BigInt("0x6C16C16A"));
    expect(res.words[3].toBigInt()).toBe(BigInt("0xEEEEEEEE"));
    for (let i = 4; i < res.words.length; i++) {
      const word = res.words[i];
      expect(word.toBigInt()).toBe(0n);
    }
  });
});
