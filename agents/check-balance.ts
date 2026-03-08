import { Client, AccountId, AccountBalanceQuery } from "@hashgraph/sdk";
const client = Client.forTestnet();
new AccountBalanceQuery()
    .setAccountId(AccountId.fromString("0.0.8127508"))
    .execute(client)
    .then(bal => console.log("Balance:", bal.hbars.toString()))
    .catch(console.error);
