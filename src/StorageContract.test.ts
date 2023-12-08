import { AccountUpdate, Bool, CircuitString, Mina, PrivateKey, PublicKey } from 'o1js';
import { Email, TwitterVerifier } from './StorageContract';

let proofsEnabled = false;

describe('TwitterVerifier', () => {
  let deployerAccount: PublicKey,
    deployerKey: PrivateKey,
    senderAccount: PublicKey,
    senderKey: PrivateKey,
    zkAppAddress: PublicKey,
    zkAppPrivateKey: PrivateKey,
    zkApp: TwitterVerifier;

  const aliceHandle = CircuitString.fromString('alice');
  const bobHandle = CircuitString.fromString('bob');

  beforeAll(async () => {
    TwitterVerifier.analyzeMethods();
    if (proofsEnabled) await TwitterVerifier.compile();
  });

  beforeEach(() => {
    const Local = Mina.LocalBlockchain({ proofsEnabled });
    Mina.setActiveInstance(Local);
    ({ privateKey: deployerKey, publicKey: deployerAccount } = Local.testAccounts[0]);
    ({ privateKey: senderKey, publicKey: senderAccount } = Local.testAccounts[1]);
    zkAppPrivateKey = PrivateKey.random();
    zkAppAddress = zkAppPrivateKey.toPublicKey();
    zkApp = new TwitterVerifier(zkAppAddress);
  });

  async function localDeploy() {
    const txn = await Mina.transaction(deployerAccount, () => {
      AccountUpdate.fundNewAccount(deployerAccount);
      zkApp.deploy();
    });
    await txn.prove();
    await txn.sign([deployerKey, zkAppPrivateKey]).send();
  }

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

  it('can register multiple Handles under the same Account', async () => {
    await localDeploy();

    const emailAlice = Email.make('support@twitter.com', aliceHandle.toString());
    const emailBob = Email.make('support@twitter.com', bobHandle.toString());

    let insert = await Mina.transaction(senderAccount, () => {
      zkApp.registerHandle(emailAlice, aliceHandle);
      zkApp.registerHandle(emailBob, bobHandle);
    });
    await insert.prove();
    await insert.sign([senderKey]).send();

    let isValidAlice!: Bool;
    let isValidBob!: Bool;
    let retrieve = await Mina.transaction(senderAccount, () => {
      isValidAlice = zkApp.validateHandle(aliceHandle, senderAccount);
      isValidBob = zkApp.validateHandle(bobHandle, senderAccount);
    });
    await retrieve.prove();
    await retrieve.sign([senderKey]).send();

    expect(isValidAlice.toBoolean()).toBe(true);
    expect(isValidBob.toBoolean()).toBe(true);
  });

  it('can register same Handle under the same Account multiple times', async () => {
    await localDeploy();

    const email = Email.make('support@twitter.com', aliceHandle.toString());

    for (let i = 0; i < 5; i++) {
      let insert = await Mina.transaction(senderAccount, () => {
        zkApp.registerHandle(email, aliceHandle);
      });
      await insert.prove();
      await insert.sign([senderKey]).send();
    }

    let isValid!: Bool;
    let retrieve = await Mina.transaction(senderAccount, () => {
      isValid = zkApp.validateHandle(aliceHandle, senderAccount);
    });
    await retrieve.prove();
    await retrieve.sign([senderKey]).send();

    expect(isValid.toBoolean()).toBe(true);
  });

  it('can overrider a registered Handle', async () => {
    await localDeploy();

    const email = Email.make('support@twitter.com', aliceHandle.toString());

    let firstInsert = await Mina.transaction(senderAccount, () => {
      zkApp.registerHandle(email, aliceHandle);
    });
    await firstInsert.prove();
    await firstInsert.sign([senderKey]).send();

    let secondInsert = await Mina.transaction(deployerAccount, () => {
      zkApp.registerHandle(email, aliceHandle);
    });
    await secondInsert.prove();
    await secondInsert.sign([deployerKey]).send();

    let isOwnedByDeployer!: Bool;
    let isOwnedBySender!: Bool;
    let retrieve = await Mina.transaction(senderAccount, () => {
      isOwnedByDeployer = zkApp.validateHandle(aliceHandle, deployerAccount);
      isOwnedBySender = zkApp.validateHandle(aliceHandle, senderAccount);
    });
    await retrieve.prove();
    await retrieve.sign([senderKey]).send();

    expect(isOwnedBySender.toBoolean()).toBe(false);
    expect(isOwnedByDeployer.toBoolean()).toBe(true);
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
