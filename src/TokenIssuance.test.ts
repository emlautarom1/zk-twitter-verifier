import { AccountUpdate, Bool, DeployArgs, Field, Mina, Permissions, PrivateKey, PublicKey, SmartContract, method } from "o1js";

const MY_TOKEN_NAME = "ZKEML"
const MY_SECRET = Field.from(420);

class TokenIssuance extends SmartContract {
  deploy(args: DeployArgs) {
    super.deploy(args);

    this.account.permissions.set({
      ...Permissions.default(),
      setTokenSymbol: Permissions.proof(),
    });
  }

  @method init() {
    super.init();
    this.account.tokenSymbol.set(MY_TOKEN_NAME);
  }

  @method submitSecret(secret: Field) {
    secret.assertEquals(MY_SECRET, "Incorrect secret");

    let update = AccountUpdate.createSigned(this.sender, this.token.id);
    update.account.permissions.set({
      ...Permissions.default(),
      editState: Permissions.proofOrSignature(),
    });
    update.body.update.appState[0].isSome = Bool(true);
    update.body.update.appState[0].value = Field(1234);
  }

  @method verifyStorage(expected: Field) {
    let update = AccountUpdate.create(this.sender, this.token.id);
    update.body.preconditions.account.state[0].isSome = Bool(true);
    update.body.preconditions.account.state[0].value = expected;
  }
}

class HighjackStorage extends SmartContract {
  @method modifyStorage(value: Field, signer: PublicKey, tokenId: Field) {
    let update = AccountUpdate.createSigned(signer, tokenId);
    update.body.update.appState[0].isSome = Bool(true);
    update.body.update.appState[0].value = value;
  }

  @method verifyStorage(value: Field, signer: PublicKey, tokenId: Field) {
    let update = AccountUpdate.create(signer, tokenId);
    update.body.preconditions.account.state[0].isSome = Bool(true);
    update.body.preconditions.account.state[0].value = value;
  }
}

let proofsEnabled = false;

describe('TokenIssuance', () => {
  let deployerAccount: PublicKey;
  let deployerKey: PrivateKey;

  let userAccount: PublicKey;
  let userKey: PrivateKey;

  let zkAppAddress: PublicKey;
  let zkAppPrivateKey: PrivateKey;
  let zkApp: TokenIssuance;

  beforeAll(async () => {
    if (proofsEnabled) await TokenIssuance.compile();
  });

  beforeEach(() => {
    const Local = Mina.LocalBlockchain({ proofsEnabled });
    Mina.setActiveInstance(Local);
    ({ privateKey: deployerKey, publicKey: deployerAccount } = Local.testAccounts[0]);
    ({ privateKey: userKey, publicKey: userAccount } = Local.testAccounts[1]);

    zkAppPrivateKey = PrivateKey.random();
    zkAppAddress = zkAppPrivateKey.toPublicKey();
    zkApp = new TokenIssuance(zkAppAddress);
  });

  async function highjackDeploy() {
    let highjackPrivateKey = PrivateKey.random();
    let highjackAddress = highjackPrivateKey.toPublicKey();
    let highjackApp = new HighjackStorage(highjackAddress);

    const deployTx = await Mina.transaction(deployerAccount, () => {
      AccountUpdate.fundNewAccount(deployerAccount);
      highjackApp.deploy();
    });
    await deployTx.prove();
    await deployTx.sign([deployerKey, highjackPrivateKey]).send();

    return highjackApp;
  }

  async function localDeploy() {
    const txn = await Mina.transaction(deployerAccount, () => {
      AccountUpdate.fundNewAccount(deployerAccount);
      zkApp.deploy({});
    });
    await txn.prove();
    await txn.sign([deployerKey, zkAppPrivateKey]).send();
  }

  it('correctly mints a new token when the secret is correct', async () => {
    await localDeploy();

    const txn = await Mina.transaction(userAccount, () => {
      // Required since we'll be creating a new account to store the custom token
      AccountUpdate.fundNewAccount(userAccount);
      zkApp.submitSecret(Field.from(420));
    });
    await txn.prove();
    await txn.sign([userKey]).send();

    const txn2 = await Mina.transaction(userAccount, () => {
      zkApp.verifyStorage(Field.from(1234));
    });
    await txn2.prove();
    await txn2.sign([userKey]).send();
  });

  it('minting a new token is idempotent', async () => {
    await localDeploy();

    const txn = await Mina.transaction(userAccount, () => {
      // Required since we'll be creating a new account to store the custom token
      AccountUpdate.fundNewAccount(userAccount);
      zkApp.submitSecret(Field.from(420));
    });
    await txn.prove();
    await txn.sign([userKey]).send();

    const txn2 = await Mina.transaction(userAccount, () => {
      zkApp.submitSecret(Field.from(420));
    });
    await txn2.prove();
    await txn2.sign([userKey]).send();

    const txn3 = await Mina.transaction(userAccount, () => {
      zkApp.verifyStorage(Field.from(1234));
    });
    await txn3.prove();
    await txn3.sign([userKey]).send();
  });

  it('prevents external contracts from highjacking the storage', async () => {
    await localDeploy();

    // Get the storage in an initial state
    const txn = await Mina.transaction(userAccount, () => {
      AccountUpdate.fundNewAccount(userAccount);
      zkApp.submitSecret(Field.from(420));
    });
    await txn.prove();
    await txn.sign([userKey]).send();

    // Deploy the highjack contract
    if (proofsEnabled) await HighjackStorage.compile();
    let highjackApp = await highjackDeploy();

    expect(async () => {
      // Highjack the storage
      const txn3 = await Mina.transaction(userAccount, () => {
        highjackApp.modifyStorage(Field.from(7890), userAccount, zkApp.token.id);
        highjackApp.verifyStorage(Field.from(7890), userAccount, zkApp.token.id);
      });
      await txn3.prove();
      await txn3.sign([userKey]).send();
    }).rejects.toThrow();
  });

  it('fails to mint a token when the secret is incorrect', async () => {
    await localDeploy();

    expect(async () => {
      const txn = await Mina.transaction(userAccount, () => {
        AccountUpdate.fundNewAccount(userAccount);
        zkApp.submitSecret(Field.from(0));
      });
      await txn.prove();
      await txn.sign([userKey]).send();
    }).rejects.toThrow("Incorrect secret");

    expect(() => Mina.getBalance(userAccount, zkApp.token.id)).toThrow();
  });
});
