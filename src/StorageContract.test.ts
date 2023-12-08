import { AccountUpdate, CircuitString, Field, Mina, PrivateKey, PublicKey } from 'o1js';
import { Option, StorageContract } from './StorageContract';

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
      value: Field(192),
    },
    1: {
      key: CircuitString.fromString('bob74'),
      value: Field(151),
    },
    2: {
      key: CircuitString.fromString('cooluser74'),
      value: Field(781),
    }
  }

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
    expect(result.value.equals(value).toBoolean()).toBe(true);
  });

  it('returns None for a key that does not exist', async () => {
    await localDeploy();

    let result!: Option;
    let txn = await Mina.transaction(senderAccount, () => {
      result = zkApp.get(CircuitString.fromString('account_does_not_exist_63'));
    });
    await txn.prove();
    await txn.sign([senderKey]).send();

    expect(result.isSome.toBoolean()).toBe(false)
  });
});
