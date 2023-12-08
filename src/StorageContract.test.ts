import { AccountUpdate, Bool, CircuitString, Mina, Poseidon, PrivateKey, PublicKey } from 'o1js';
import { Email, Option, StorageContract } from './StorageContract';

let proofsEnabled = false;

describe('StorageContract', () => {
  let deployerAccount: PublicKey,
    deployerKey: PrivateKey,
    senderAccount: PublicKey,
    senderKey: PrivateKey,
    zkAppAddress: PublicKey,
    zkAppPrivateKey: PrivateKey,
    zkApp: StorageContract;

  let map = {
    0: {
      key: CircuitString.fromString('alice123'),
      value: PrivateKey.random().toPublicKey(),
    },
    1: {
      key: CircuitString.fromString('bob74'),
      value: PrivateKey.random().toPublicKey(),
    },
    2: {
      key: CircuitString.fromString('cooluser74'),
      value: PrivateKey.random().toPublicKey(),
    }
  }

  const aliceHandle = CircuitString.fromString('alice');
  const bobHandle = CircuitString.fromString('bob');

  beforeAll(async () => {
    StorageContract.analyzeMethods();
    if (proofsEnabled) await StorageContract.compile();
  });

  beforeEach(() => {
    const Local = Mina.LocalBlockchain({ proofsEnabled });
    Mina.setActiveInstance(Local);
    ({ privateKey: deployerKey, publicKey: deployerAccount } = Local.testAccounts[0]);
    ({ privateKey: senderKey, publicKey: senderAccount } = Local.testAccounts[1]);
    zkAppPrivateKey = PrivateKey.random();
    zkAppAddress = zkAppPrivateKey.toPublicKey();
    zkApp = new StorageContract(zkAppAddress);
  });

  async function localDeploy() {
    const txn = await Mina.transaction(deployerAccount, () => {
      AccountUpdate.fundNewAccount(deployerAccount);
      zkApp.deploy();
    });
    await txn.prove();
    await txn.sign([deployerKey, zkAppPrivateKey]).send();
  }

  it('can add a key-value pair', async () => {
    await localDeploy();

    let { key, value } = map[0];

    let insert = await Mina.transaction(senderAccount, () => {
      zkApp.set(key, value);
    });
    await insert.prove();
    await insert.sign([senderKey]).send();

    let result!: Option;
    let retrieve = await Mina.transaction(senderAccount, () => {
      result = zkApp.get(key);
    });
    await retrieve.prove();
    await retrieve.sign([senderKey]).send();

    expect(result.isSome.toBoolean()).toBe(true);
    expect(result.value.equals(Poseidon.hash(value.toFields())).toBoolean()).toBe(true);
  });

  it('returns None for a key that does not exist', async () => {
    await localDeploy();

    let result!: Option;
    let txn = await Mina.transaction(senderAccount, () => {
      result = zkApp.get(CircuitString.fromString('does_not_exist_63'));
    });
    await txn.prove();
    await txn.sign([senderKey]).send();

    expect(result.isSome.toBoolean()).toBe(false)
  });

  it('can register a Handle using a valid Email', async () => {
    await localDeploy();

    const email = Email.make('support@twitter.com', aliceHandle.toString());

    let insert = await Mina.transaction(senderAccount, () => {
      zkApp.registerHandle(email, aliceHandle);
    });
    await insert.prove();
    await insert.sign([senderKey]).send();

    let isValid!: Bool;
    let retrieve = await Mina.transaction(senderAccount, () => {
      isValid = zkApp.validateHandle(aliceHandle, senderAccount);
    });
    await retrieve.prove();
    await retrieve.sign([senderKey]).send();

    expect(isValid.toBoolean()).toBe(true);
  });

  it('fails to register a Handle when Email and Handle mismatch', async () => {
    await localDeploy();

    const email = Email.make('support@twitter.com', aliceHandle.toString());

    expect(async () => {
      let insert = await Mina.transaction(senderAccount, () => {
        zkApp.registerHandle(email, bobHandle);
      });
      await insert.prove();
      await insert.sign([senderKey]).send();
    }).rejects.toThrow();
  });

  it('fails to register a Handle when Email is not from a trusted provider', async () => {
    await localDeploy();

    const email = Email.make('support@tweets.com', aliceHandle.toString());

    expect(async () => {
      let insert = await Mina.transaction(senderAccount, () => {
        zkApp.registerHandle(email, aliceHandle);
      });
      await insert.prove();
      await insert.sign([senderKey]).send();
    }).rejects.toThrow();
  });

  it('returns false for a Handle that has not been registered', async () => {
    await localDeploy();

    let isValid!: Bool;
    let retrieve = await Mina.transaction(senderAccount, () => {
      isValid = zkApp.validateHandle(bobHandle, senderAccount);
    });
    await retrieve.prove();
    await retrieve.sign([senderKey]).send();

    expect(isValid.toBoolean()).toBe(false);
  });

  it('returns false for a Handle that has been registered under a different Account', async () => {
    await localDeploy();

    const email = Email.make('support@twitter.com', aliceHandle.toString());

    let insert = await Mina.transaction(senderAccount, () => {
      zkApp.registerHandle(email, aliceHandle);
    });
    await insert.prove();
    await insert.sign([senderKey]).send();

    let isValid!: Bool;
    let retrieve = await Mina.transaction(senderAccount, () => {
      isValid = zkApp.validateHandle(aliceHandle, PrivateKey.random().toPublicKey());
    });
    await retrieve.prove();
    await retrieve.sign([senderKey]).send();

    expect(isValid.toBoolean()).toBe(false);
  });
});
