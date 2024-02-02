import { AccountUpdate, DeployArgs, Field, Mina, Permissions, PrivateKey, PublicKey, SmartContract, method } from "o1js";

const MY_TOKEN_NAME = "ZKEML"
const MY_SECRET = Field.from(420);

class TokenIssuance extends SmartContract {
  deploy(args: DeployArgs) {
    super.deploy(args);

    const permissionToEdit = Permissions.none();

    this.account.permissions.set({
      ...Permissions.default(),
      incrementNonce: permissionToEdit,
      editState: permissionToEdit,
      setTokenSymbol: permissionToEdit,
      send: permissionToEdit,
      receive: permissionToEdit,
    });
  }

  @method init() {
    super.init();
    this.account.tokenSymbol.set(MY_TOKEN_NAME);
  }

  @method submitSecret(secret: Field) {
    secret.assertEquals(MY_SECRET);

    this.token.mint({
      address: this.sender,
      amount: 1,
    });

  }
}

let proofsEnabled = true;

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
      AccountUpdate.fundNewAccount(userAccount);
      zkApp.submitSecret(Field.from(420));
    });
    await txn.prove();
    await txn.sign([userKey]).send();

    let tokenBalance: bigint = Mina.getBalance(userAccount, zkApp.token.id).value.toBigInt();
    expect(tokenBalance).toEqual(1n);
  });
});
