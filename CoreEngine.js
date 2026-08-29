const { ethers } = require("ethers");
const http = require("http");

// خادم HTTP مصغر لتلبية متطلبات منصة Render
const PORT = process.env.PORT || 10000;
const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Baran Command Center & Multi-Pair Engine is active!\n");
});
server.listen(PORT, () => {
    console.log(`HTTP server is listening on port ${PORT}`);
});

const RPC_URL = process.env.RPC_URL || "https://api.avax.network/ext/bc/C/rpc";
const TELEGRAM_BOT_TOKEN = "8750924124:AAHMXaJlzI8iHLSzdrDmWjYJNE6wDaH072M";
const TELEGRAM_CHAT_ID = "589920599";

const provider = new ethers.JsonRpcProvider(RPC_URL);

const ROUTER_TRADER_JOE = "0x60ae616a2155ee3d9a68541ba4544862310933d4";
const ROUTER_PANGOLIN = "0xe54ca86531e17ef3616d22ca28b0d458b6c81616";

const ROUTER_ABI = [
    "function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)"
];

const WAVAX = "0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7";

const TARGET_TOKENS = [
    { name: "USDT", address: "0x9702230a8ea53601f5cd2dc00fdbc13d4d4a84fd", decimals: 6 },
    { name: "USDC.e", address: "0xa7d7079b0fead9163e65000e819f6db45a0f87c4", decimals: 6 },
    { name: "JOE", address: "0x6e846114e9f7bd1677ee5048434f13e9fe6da0c7", decimals: 18 }
];

const TRADE_AMOUNT = ethers.parseUnits("1.0", 18);
const ESTIMATED_GAS_UNITS = 250000n;

let lastScannedBlock = 0;
let totalScansCount = 0;
let telegramOffset = 0;

async function sendTelegramMessage(chatId, message) {
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: chatId,
                text: message,
                parse_mode: "Markdown"
            })
        });
    } catch (error) {
        console.error("Telegram Dispatch Error:", error.message);
    }
}

async function scanMarketOpportunities(isManualTrigger = false, manualChatId = null) {
    try {
        totalScansCount++;
        const currentBlock = await provider.getBlockNumber();
        lastScannedBlock = currentBlock;

        const traderJoeContract = new ethers.Contract(ROUTER_TRADER_JOE, ROUTER_ABI, provider);
        const pangolinContract = new ethers.Contract(ROUTER_PANGOLIN, ROUTER_ABI, provider);

        const feeData = await provider.getFeeData();
        const gasPrice = feeData.gasPrice || feeData.maxFeePerGas || ethers.parseUnits("25", 9);
        const gasCostInAvax = gasPrice * ESTIMATED_GAS_UNITS;

        let foundOpportunity = false;

        for (const token of TARGET_TOKENS) {
            try {
                const pathForward = [WAVAX, token.address];

                let amountsJoe = null;
                let amountsPangolin = null;

                try {
                    amountsJoe = await traderJoeContract.getAmountsOut(TRADE_AMOUNT, pathForward);
                } catch (e) {}

                try {
                    amountsPangolin = await pangolinContract.getAmountsOut(TRADE_AMOUNT, pathForward);
                } catch (e) {}

                if (!amountsJoe || !amountsPangolin) continue;

                const outputJoe = amountsJoe[1];
                const outputPangolin = amountsPangolin[1];

                let grossProfit = 0n;
                let executionRoute = "";

                if (outputJoe > outputPangolin) {
                    grossProfit = outputJoe - outputPangolin;
                    executionRoute = "Buy on Pangolin ➔ Sell on Trader Joe";
                } else {
                    grossProfit = outputPangolin - outputJoe;
                    executionRoute = "Buy on Trader Joe ➔ Sell on Pangolin";
                }

                let wavaxToTokenRate = ethers.parseUnits("25", token.decimals);
                try {
                    const rateAmounts = await traderJoeContract.getAmountsOut(ethers.parseUnits("1.0", 18), pathForward);
                    wavaxToTokenRate = rateAmounts[1];
                } catch (e) {}

                const gasCostInToken = (gasCostInAvax * wavaxToTokenRate) / ethers.parseUnits("1.0", 18);
                const netProfit = grossProfit - gasCostInToken;

                const minNetProfitThreshold = token.name === "JOE" ? ethers.parseUnits("0.1", token.decimals) : ethers.parseUnits("0.02", token.decimals);

                if (netProfit > minNetProfitThreshold) {
                    foundOpportunity = true;
                    const alertText =
                        `🚀 *Baran Arbitrage Signal (${token.name})!*\n\n` +
                        `📍 *Route:* ${executionRoute}\n` +
                        `💰 *Gross Spread:* ${ethers.formatUnits(grossProfit, token.decimals)} ${token.name}\n` +
                        `⛽ *Gas Cost:* ${ethers.formatUnits(gasCostInToken, token.decimals)} ${token.name}\n` +
                        `✨ *Net Profit:* \`${ethers.formatUnits(netProfit, token.decimals)} ${token.name}\`\n` +
                        `🌐 *Block:* ${currentBlock}`;

                    console.log(alertText);
                    await sendTelegramMessage(TELEGRAM_CHAT_ID, alertText);
                }
            } catch (errToken) {}
        }

        if (isManualTrigger && manualChatId) {
            const reportText = `📊 *Manual Scan Report*\n\n` +
                `- Current Block: ${currentBlock}\n` +
                `- Total Scans: ${totalScansCount}\n` +
                `- Status: Engine is fully operational and scanning parallel pairs successfully.`;
            await sendTelegramMessage(manualChatId, reportText);
        } else {
            console.log(`Scanning block ${currentBlock} across all target pairs... Engine operating smoothly.`);
        }

    } catch (error) {
        console.error("Scanner Loop Error:", error.message);
    }
}

async function pollTelegramCommands() {
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${telegramOffset}&timeout=5`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.ok && data.result.length > 0) {
            for (const update of data.result) {
                telegramOffset = update.update_id + 1;

                if (update.message && update.message.text) {
                    const chatId = update.message.chat.id;
                    const text = update.message.text.trim();

                    if (text === "/status") {
                        const statusMsg = `🟢 *Baran Engine Status*\n\n` +
                            `- State: Live & Active\n` +
                            `- Last Block: ${lastScannedBlock}\n` +
                            `- Total Scans: ${totalScansCount}\n` +
                            `- Active Pairs: USDT, USDC.e, JOE`;
                        await sendTelegramMessage(chatId, statusMsg);
                    } else if (text === "/scan") {
                        await sendTelegramMessage(chatId, `🔍 Executing immediate manual market scan...`);
                        await scanMarketOpportunities(true, chatId);
                    } else if (text === "/help") {
                        const helpMsg = `🤖 *Baran Bot Commands*\n\n` +
                            `/status - Check system health and stats\n` +
                            `/scan - Trigger manual market scan\n` +
                            `/help - Show available commands`;
                        await sendTelegramMessage(chatId, helpMsg);
                    }
                }
            }
        }
    } catch (err) {
        // Silent catch for polling connection stability
    }
}

console.log("Baran Command Center & Multi-Pair Engine Activated.");
setInterval(() => scanMarketOpportunities(false), 4000);
setInterval(pollTelegramCommands, 3000);