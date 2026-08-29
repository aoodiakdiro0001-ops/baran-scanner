const { ethers } = require("ethers");

const RPC_URL = process.env.RPC_URL || "https://api.avax.network/ext/bc/C/rpc";
const TELEGRAM_BOT_TOKEN = "8750924124:AAHMXaJlzI8iHLSzdrDmWjYJNE6wDaH072M";
const TELEGRAM_CHAT_ID = "589920599";

const provider = new ethers.JsonRpcProvider(RPC_URL);

const ROUTER_TRADER_JOE = "0x60aE616a2155Ee3d9A68541Ba4544862310933d4";
const ROUTER_PANGOLIN = "0xE54Ca86531e17ef3616d22Ca28b0D458b6C81616";

const ROUTER_ABI = [
    "function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)"
];

const WAVAX = "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7";
const USDC = "0xB97EF9Ef8734C71904D8002F8b6bc66Dd9c48a6E";

const TRADE_AMOUNT = ethers.parseUnits("0.5", 18);

async function sendTelegramAlert(message) {
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text: message,
                parse_mode: "Markdown"
            })
        });
    } catch (error) {
        console.error("Telegram Dispatch Error:", error.message);
    }
}

async function scanMarketOpportunities() {
    try {
        const traderJoeContract = new ethers.Contract(ROUTER_TRADER_JOE, ROUTER_ABI, provider);
        const pangolinContract = new ethers.Contract(ROUTER_PANGOLIN, ROUTER_ABI, provider);

        const pathForward = [WAVAX, USDC];

        const amountsJoe = await traderJoeContract.getAmountsOut(TRADE_AMOUNT, pathForward);
        const amountsPangolin = await pangolinContract.getAmountsOut(TRADE_AMOUNT, pathForward);

        const outputJoe = amountsJoe[1];
        const outputPangolin = amountsPangolin[1];

        let priceDifference = 0n;
        let executionRoute = "";

        if (outputJoe > outputPangolin) {
            priceDifference = outputJoe - outputPangolin;
            executionRoute = "Buy on Pangolin -> Sell on Trader Joe";
        } else {
            priceDifference = outputPangolin - outputJoe;
            executionRoute = "Buy on Trader Joe -> Sell on Pangolin";
        }

        const profitThreshold = (TRADE_AMOUNT * 2n) / 1000n;

        if (priceDifference > profitThreshold) {
            const alertText = `🚨 *Baran Arbitrage Signal Detected!*\n\nRoute: ${executionRoute}\nSpread: ${ethers.formatUnits(priceDifference, 6)} USDC\nNetwork: Avalanche C-Chain`;
            console.log(alertText);
            await sendTelegramAlert(alertText);
        } else {
            console.log("Scanning block... Market balanced.");
        }

    } catch (error) {
        console.error("Scanner Loop Error:", error.message);
    }
}

console.log("Baran Autonomous Engine Activated. Scanning blocks...");
setInterval(scanMarketOpportunities, 4000);