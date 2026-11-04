# Move

**Move anywhere. Pay onchain.**

Global decentralized transport discovery and booking platform built on **BOT Chain**.

Anyone, anywhere can search routes, book seats and pay with BOT or USDT.  
Operators register vehicles, publish schedules and receive instant on-chain settlements.  
Every booking, payment and review lives permanently on-chain. No traditional backend.

## Stack

- HTML5 · CSS3 · Vanilla JavaScript
- ethers.js v6
- Solidity ^0.8.20
- BOT Chain (Chain ID 677)

## Structure

```
move/
├── contracts/Move.sol
├── frontend/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── docs/Move_Whitepaper.pdf
└── README.md
```

## BOT Chain

| Parameter    | Value                                      |
|--------------|--------------------------------------------|
| Chain ID     | 677                                        |
| RPC          | https://rpc.botchain.ai                    |
| Explorer     | https://scan.botchain.ai                   |
| Native       | BOT (18 decimals)                          |
| USDT         | 0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C |

## Features

- Global route search (any origin → any destination)
- Passenger dashboard: search, book, pay, cancel, history, QR
- Operator dashboard: register company, vehicles, publish routes
- BOT & USDT payments with automatic fee split
- On-chain seat locking (no double-booking)
- 90% refund if cancelled ≥2 h before departure
- On-chain reviews
- Admin verification of operators

## Deploy

1. Deploy `Move.sol` on BOT Chain  
   Constructor: `(USDT address, platformFeeBps)` e.g. `(0xaBabc7…, 200)`

2. Set `CONTRACT_ADDRESS` in `frontend/app.js`

3. Serve the `frontend/` folder

Until the contract is live the UI runs in demo mode with sample routes.

## Links

- BOT Chain: https://botchain.ai  
- Explorer: https://scan.botchain.ai  
- Whitepaper: `docs/Move_Whitepaper.pdf`

---

Built on BOT Chain.
# move
