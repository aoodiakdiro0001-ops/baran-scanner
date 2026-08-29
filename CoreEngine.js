const { ethers } = require("ethers");
const http = require("http");

const PORT = process.env.PORT || 10000;
const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Baran Command Center & Base Multi-Pair Engine is active!\n");
});
server.listen(PORT, () => {
    console.log(`HTTP server is listening on port ${PORT}`);
});

const RPC_URL = process.env.RPC_URL || "https://mainnet.base.org";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ? process.env.TELEGRAM_BOT_TOKEN.trim() : "";
const TELEGRAM_CHAT_ID = "589920599";

if (!TELEGRAM_BOT_TOKEN) {
    console.error("CRITICAL ERROR: TELEGRAM_BOT_TOKEN is missing in environment variables!");
} else {
    console.log("Loaded Telegram Token Successfully. Prefix:", TELEGRAM_BOT_TOKEN.substring(0, 10) + "...");
}

const provider = new ethers.JsonRpcProvider(RPC_URL);

const ROUTER_BASESWAP = "0x327Df1Ede4564DDf2Bf58fD50C4f6Facd6557cd8";
const ROUTER_ALIENBASE = "0x16345EA9518e3881477F5C7C3E29EB3e717D5c7d";

const ROUTER_ABI = [
    "function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)"
];

const WETH = "0x4200000000000000000000000000000000000006";

const TARGET_TOKENS = [
    { name: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
    { name: "DEGEN", address: "0x4ed4E862860b21aae1d87fb1d459dc28f1e7bc8c", decimals: 18 },
    { name: "CBETH", address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22", decimals: 18 }
];

const TRADE_AMOUNT = ethers.parseUnits("0.05", 18);
const ESTIMATED_GAS_UNITS = 180000n;

let lastScannedBlock = 0;
let totalScansCount = 0;
let telegramOffset = 0;

async function sendTelegramMessage(chatId, message) {
    if (!TELEGRAM_BOT_TOKEN) return;
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

async function clearTelegramWebhook() {
    if (!TELEGRAM_BOT_TOKEN) return;
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/deleteWebhook?drop_pending_updates=true`;
        const res = await fetch(url);
        const data = await res.json();
        console.log("Webhook cleared response:", data);
    } catch (err) {
        console.error("Failed to clear webhook:", err.message);
    }
}

async function scanMarketOpportunities(isManualTrigger = false, manualChatId = null) {
    try {
        totalScansCount++;
        const currentBlock = await provider.getBlockNumber();
        lastScannedBlock = currentBlock;

        const baseSwapContract = new ethers.Contract(ROUTER_BASESWAP, ROUTER_ABI, provider);
        const alienBaseContract = new ethers.Contract(ROUTER_ALIENBASE, ROUTER_ABI, provider);

        const feeData = await provider.getFeeData();
        const gasPrice = feeData.gasPrice || feeData.maxFeePerGas || ethers.parseUnits("0.01", 9);
        const gasCostInWeth = gasPrice * ESTIMATED_GAS_UNITS;

        for (const token of TARGET_TOKENS) {
            try {
                const pathForward = [WETH, token.address];

                let amountsBaseSwap = null;
                let amountsAlienBase = null;

                try {
                    amountsBaseSwap = await baseSwapContract.getAmountsOut(TRADE_AMOUNT, pathForward);
                } catch (e) {}

                try {
                    amountsAlienBase = await alienBaseContract.getAmountsOut(TRADE_AMOUNT, pathForward);
                } catch (e) {}

                if (!amountsBaseSwap || !amountsAlienBase) continue;

                const outputBaseSwap = amountsBaseSwap[1];
                const outputAlienBase = amountsAlienBase[1];

                let grossProfit = 0n;
                let executionRoute = "";

                if (outputBaseSwap > outputAlienBase) {
                    grossProfit = outputBaseSwap - outputAlienBase;
                    executionRoute = "Buy on AlienBase ➔ Sell on BaseSwap";
                } else {
                    grossProfit = outputAlienBase - outputBaseSwap;
                    executionRoute = "Buy on BaseSwap ➔ Sell on AlienBase";
                }

                let wethToTokenRate = ethers.parseUnits("1", token.decimals);
                try {
                    const rateAmounts = await baseSwapContract.getAmountsOut(ethers.parseUnits("1.0", 18), pathForward);
                    wethToTokenRate = rateAmounts[1];
                } catch (e) {}

                const gasCostInToken = (gasCostInWeth * wethToTokenRate) / ethers.parseUnits("1.0", 18);
                const netProfit = grossProfit - gasCostInToken;

                const minNetProfitThreshold = token.name === "USDC" ? ethers.parseUnits("0.01", token.decimals) : ethers.parseUnits("1.0", token.decimals);

                if (netProfit > minNetProfitThreshold) {
                    const alertText =
                        `🚀 *Baran Base Arbitrage Signal (${token.name})!*\n\n` +
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
            const reportText = `📊 *Base Manual Scan Report*\n\n` +
                `- Current Block: ${currentBlock}\n` +
                `- Total Scans: ${totalScansCount}\n` +
                `- Status: Base Engine is fully operational and scanning multi-pairs with near-zero gas.`;
            await sendTelegramMessage(manualChatId, reportText);
        } else {
            console.log(`Scanning block ${currentBlock} across Base target pairs... Engine operating smoothly.`);
        }

    } catch (error) {
        console.error("Scanner Loop Error:", error.message);
    }
}

async function pollTelegramCommands() {
    if (!TELEGRAM_BOT_TOKEN) return;
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${telegramOffset}&timeout=2`;
        const response = await fetch(url);
        const data = await response.json();

        if (!data.ok) {
            console.error("Telegram Polling Error Response:", data);
            return;
        }

        if (data.result && data.result.length > 0) {
            for (const update of data.result) {
                telegramOffset = update.update_id + 1;

                if (update.message && update.message.text) {
                    const chatId = update.message.chat.id;
                    const text = update.message.text.trim();
                    console.log(`Received command from chat ${chatId}: ${text}`);

                    if (text === "/status") {
                        const statusMsg = `🟢 *Baran Base Engine Status*\n\n` +
                            `- State: Live & Active (Base Network)\n` +
                            `- Last Block: ${lastScannedBlock}\n` +
                            `- Total Scans: ${totalScansCount}\n` +
                            `- Active Pairs: USDC, DEGEN, CBETH`;
                        await sendTelegramMessage(chatId, statusMsg);
                    } else if (text === "/scan") {
                        await sendTelegramMessage(chatId, `🔍 Executing immediate Base market scan...`);
                        await scanMarketOpportunities(true, chatId);
                    } else if (text === "/help") {
                        const helpMsg = `🤖 *Baran Bot Commands*\n\n` +
                            `/status - Check system health and stats\n` +
                            `/scan - Trigger manual market scan\n` +
                            `/help - Show available commands`;
                        await sendTelegramMessage(chatId, helpMsg);
                    } else {
                        await sendTelegramMessage(chatId, `❓ Unknown command. Use /help to see available commands.`);
                    }
                }
            }
        }
    } catch (err) {
        console.error("Poll Exception:", err.message);
    }
}

console.log("Baran Command Center & Base Multi-Pair Engine Initializing...");
clearTelegramWebhook().then(() => {
    setInterval(() => scanMarketOpportunities(false), 4000);
    setInterval(pollTelegramCommands, 3000);
});