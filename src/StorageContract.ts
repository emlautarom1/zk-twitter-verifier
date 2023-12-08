import {
  Bool,
  Field,
  Poseidon,
  Provable,
  PublicKey,
  Reducer,
  SmartContract,
  Struct,
  method,
  provable
} from 'o1js';

/*
 
This contract emulates a "mapping" data structure, which is a key-value store, similar to a dictionary or hash table or `new Map<K, V>()` in JavaScript.
In this example, the keys are public keys, and the values are arbitrary field elements.
 
This utilizes the `Reducer` as an append online list of actions, which are then looked at to find the value corresponding to a specific key.
 
 
```ts 
// js
const map = new Map<PublicKey, Field>();
map.set(key, value);
map.get(key);
 
// contract
zkApp.deploy(); // ... deploy the zkapp
zkApp.set(key, value); // ... set a key-value pair
zkApp.get(key); // ... get a value by key
```
*/

export class Option extends Struct({
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

export class StorageContract extends SmartContract {
  reducer = Reducer({
    actionType: KeyValuePair,
  });

  @method set(key: PublicKey, value: Field) {
    this.reducer.dispatch({ key: Poseidon.hash(key.toFields()), value });
  }

  @method get(key: PublicKey): Option {
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