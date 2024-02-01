import { Provable, ZkProgram } from "o1js";
import { UInt2048 } from "./BigInt.test";

export function RSA65537Verify(message: UInt2048, signature: UInt2048, modulus: UInt2048) {
  // compute signature^(2^16 + 1) % modulus
  let actual = signature;

  // Square 16 times
  for (let i = 0; i < 16; i++) {
    actual = actual.mulMod(actual, modulus);
  }
  // Multiply by `signature` to get the (+1)
  actual = actual.mulMod(signature, modulus);

  Provable.assertEqual(UInt2048, actual, message);
}

describe("RSA JS", () => {

  it("verifies a valid (message, signature)", () => {
    let message = UInt2048.fromBigInt(0x605B02B466006BC343D612DAE943704E571B0341A47578F24FFD8BB45753D4F97EC6095C768F02A984BE5B0816866D36EB7964193026ABBA52B3D372EA2D84FF5ED7FB42E1A13E186ABCEB4BF79A083E417A2ACC7ED7BF5CAC124A48280BE9E285EB91D935704224DCEB28CF60CB6C1BDA043D3A7FFB2A47CAB1022B171B231C50A699BB6BC6BDC0C6C140ECF98CAFF3B841B92CE9005C8B08C587ECEA462E9B151175FEF3545122F176F9A931CDD55E8075189B33E484DBF8CD7D92DBEA0B3FD7B4389A4C3354BFF6719ADC62897C2D0BA8F84E1DF720A64A8834B954796A830B0A01AC8D8C36218442BE22FDBC29C932220E0400DABEF283C865FC24DD5253n);
    let signature = UInt2048.fromBigInt(0x3A9D0B6E2F575372AFD014CD788B7C06F13190B6A15B7F46EE4DEF122B001C92FA33150C5EAB0B045096467B9573363630187880500645EDEC06AAAE8CD6447796AF95C499C14AE86684B56B52B2D389D6DAA852ED1835E0AB821361E8BE1BA3CEEBBB009DB1C1CF07D3BD63AD4ACEFB5B06E3DF55DC9FA47DC1EDDF0C4E128A7A7EF30CB13E7F8C7E0D6A2EDCB1FBF2130707532E84330750E23A3DF0EB3A8298BA36DB132357DEB933B6971FD78116B782EB6F8AC5B85B31D6ACCA4153230A492397E65DB45E9FD8A6E5E0BF0B255FCD636DD3F07FCAA11DC0A0BD13136F57AC6CFACC210BCE875C51980A1C00FE3B1ED245D28FB4EF46FCF6C9F64F859733n);
    let modulo = UInt2048.fromBigInt(0xA69BDDB10F2AB9EECC06C1D817464D63E4C449C8430E47DD2402D65FE329A4214E2C090F582149EB80E90580B767AD5210AF0A746448877FD356C8EA0D0C32CD15164858F85C8F98BE9F96B9F76E507881B19437E2E53069CA3895916C797AA144895467A4CAE66DCE995782CF6E40EFDCB87B528C31D17CEF0C223B3A42F1534CF3AA6AB72696A364E0D1C1EE02DD00248C653797EB7E799F880ABB21969BE957178B4CA1A82690078E9D730853BFE3881C5D773E41ED5A0B28C440B7DC625C229A3F39F56A2898871911E6D2424846E54A7FF61912A635BF746BC0D5E2CDD3716DEC51AFB5D232D59C163B8472FA6376C23E8D47DFE0F1A139385C13F05FB1n);

    RSA65537Verify(message, signature, modulo);
  });
});

// ZK-Program tests

let TestProgram = ZkProgram({
  name: "TestProgram",
  methods: {
    rsa65537Verify: {
      privateInputs: [UInt2048, UInt2048, UInt2048],
      method(message: UInt2048, signature: UInt2048, modulus: UInt2048) {
        RSA65537Verify(message, signature, modulus);
      }
    },
  }
});

describe("RSA ZK", () => {
  beforeAll(async () => {
    let analysis = TestProgram.analyzeMethods();
    console.log({
      "rsa65537Verify": analysis.rsa65537Verify.rows,
    });
    await TestProgram.compile();
  });

  // Disabled since it takes too long (did not finish after +40 mins)
  xit("verifies a valid (message, signature)", async () => {
    let message = UInt2048.fromBigInt(0x605B02B466006BC343D612DAE943704E571B0341A47578F24FFD8BB45753D4F97EC6095C768F02A984BE5B0816866D36EB7964193026ABBA52B3D372EA2D84FF5ED7FB42E1A13E186ABCEB4BF79A083E417A2ACC7ED7BF5CAC124A48280BE9E285EB91D935704224DCEB28CF60CB6C1BDA043D3A7FFB2A47CAB1022B171B231C50A699BB6BC6BDC0C6C140ECF98CAFF3B841B92CE9005C8B08C587ECEA462E9B151175FEF3545122F176F9A931CDD55E8075189B33E484DBF8CD7D92DBEA0B3FD7B4389A4C3354BFF6719ADC62897C2D0BA8F84E1DF720A64A8834B954796A830B0A01AC8D8C36218442BE22FDBC29C932220E0400DABEF283C865FC24DD5253n);
    let signature = UInt2048.fromBigInt(0x3A9D0B6E2F575372AFD014CD788B7C06F13190B6A15B7F46EE4DEF122B001C92FA33150C5EAB0B045096467B9573363630187880500645EDEC06AAAE8CD6447796AF95C499C14AE86684B56B52B2D389D6DAA852ED1835E0AB821361E8BE1BA3CEEBBB009DB1C1CF07D3BD63AD4ACEFB5B06E3DF55DC9FA47DC1EDDF0C4E128A7A7EF30CB13E7F8C7E0D6A2EDCB1FBF2130707532E84330750E23A3DF0EB3A8298BA36DB132357DEB933B6971FD78116B782EB6F8AC5B85B31D6ACCA4153230A492397E65DB45E9FD8A6E5E0BF0B255FCD636DD3F07FCAA11DC0A0BD13136F57AC6CFACC210BCE875C51980A1C00FE3B1ED245D28FB4EF46FCF6C9F64F859733n);
    let modulo = UInt2048.fromBigInt(0xA69BDDB10F2AB9EECC06C1D817464D63E4C449C8430E47DD2402D65FE329A4214E2C090F582149EB80E90580B767AD5210AF0A746448877FD356C8EA0D0C32CD15164858F85C8F98BE9F96B9F76E507881B19437E2E53069CA3895916C797AA144895467A4CAE66DCE995782CF6E40EFDCB87B528C31D17CEF0C223B3A42F1534CF3AA6AB72696A364E0D1C1EE02DD00248C653797EB7E799F880ABB21969BE957178B4CA1A82690078E9D730853BFE3881C5D773E41ED5A0B28C440B7DC625C229A3F39F56A2898871911E6D2424846E54A7FF61912A635BF746BC0D5E2CDD3716DEC51AFB5D232D59C163B8472FA6376C23E8D47DFE0F1A139385C13F05FB1n);

    let proof = await TestProgram.rsa65537Verify(message, signature, modulo);
    proof.verify();
  });
});
