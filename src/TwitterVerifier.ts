import { Bool, CircuitString, Field, Poseidon, Provable, PublicKey, Reducer, SmartContract, Struct, method, provable } from 'o1js';

export class Email extends Struct({
  provider: CircuitString,
  handle: CircuitString,
}) {
  static make(provider: string, handle: string) {
    return new Email({
      provider: CircuitString.fromString(provider),
      handle: CircuitString.fromString(handle),
    });
  }
}

class Option extends Struct({
  isSome: Bool,
  value: Field,
}) {
  static empty(): Option {
    return new Option({ isSome: Bool(false), value: Field(0) });
  }
}

const KeyValuePair = provable({
  key: Field,
  value: Field,
});

export class TwitterVerifier extends SmartContract {
  reducer = Reducer({
    actionType: KeyValuePair,
  });

  @method registerHandle(email: Email, handle: CircuitString) {
    /*
    // Source: https://github.com/kmille/dkim-verify/blob/master/verify-dkim.py
    // Inputs:
    mail = parseEmail("email.eml")
    publicKey = <twitter hard coded public key>
    // In ZK-Program:
    dkim = parseDKIMHeader(mail["DKIM-Signature"])
    body = mail["Body"]
    hashBody(body).assertEquals(dkim["bh"])
    headersH = hashHeaders(mail, dkim["h"])
    signature = dkim["b"]
    verify(hh, signature, publicKey).assertTrue()
    */
    const expectedProvider = CircuitString.fromString("support@twitter.com");

    let emailProvider: CircuitString = email.provider;
    let emailHandle: CircuitString = email.handle;

    emailProvider.assertEquals(expectedProvider);
    emailHandle.assertEquals(handle);

    this.set(email.handle, this.sender);
  }

  @method validateHandle(handle: CircuitString, owner: PublicKey): Bool {
    let storedOwner = this.get(handle);
    return storedOwner.isSome.and(storedOwner.value.equals(Poseidon.hash(owner.toFields())));
  }

  private set(key: CircuitString, value: PublicKey) {
    this.reducer.dispatch({ key: Poseidon.hash(key.toFields()), value: Poseidon.hash(value.toFields()) });
  }

  private get(key: CircuitString): Option {
    let pendingActions = this.reducer.getActions({
      fromActionState: Reducer.initialActionState,
    });

    let keyHash = Poseidon.hash(key.toFields());

    let { state: optionValue } = this.reducer.reduce(
      pendingActions,
      Option,
      (
        _state: Option,
        _action: {
          key: Field;
          value: Field;
        }
      ) => {
        let currentMatch = keyHash.equals(_action.key);
        return {
          isSome: currentMatch.or(_state.isSome),
          value: Provable.if(currentMatch, _action.value, _state.value),
        };
      },
      {
        state: Option.empty(),
        actionState: Reducer.initialActionState,
      },
      { maxTransactionsWithActions: k }
    );

    return optionValue;
  }
}

const k = 1 << 8;
