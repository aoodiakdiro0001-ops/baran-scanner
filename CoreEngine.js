const { ethers } = require("ethers");
const http = require("http");

// خادم HTTP مصغر لتلبية متطلبات منصة Render
const PORT = process.env.PORT || 10000;
const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Baran Multi-Pair Micro-Engine is active and running!\n");
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

// قائمة العملات المستهدفة للمسح المتوازي في نفس البلوك
const TARGET_TOKENS = [
    { name: "USDT", address: "0x9702230a8ea53601f5cd2dc00fdbc13d4d4a84fd", decimals: 6 },
    { name: "USDC.e", address: "0xa7d7079b0fead9163e65000e819f6db45a0f87c4", decimals: 6 },
    { name: "JOE", address: "0x6e846114e9f7bd1677ee5048434f13e9fe6da0c7", decimals: 18 }
];

const TRADE_AMOUNT = ethers.parseUnits("1.0", 18); // حجم التداول (1 AVAX)
const ESTIMATED_GAS_UNITS = 250000n;

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

        // جلب تسعيرة الغاز مرة واحدة لكل بلوك
        const feeData = await provider.getFeeData();
        const gasPrice = feeData.gasPrice || feeData.maxFeePerGas || ethers.parseUnits("25", 9);
        const gasCostInAvax = gasPrice * ESTIMATED_GAS_UNITS;

        // مسح كل العملات في القائمة بالتوازي
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

                // حساب قيمة الغاز بالعملة الحالية
                let wavaxToTokenRate = ethers.parseUnits("25", token.decimals);
                try {
                    const rateAmounts = await traderJoeContract.getAmountsOut(ethers.parseUnits("1.0", 18), pathForward);
                    wavaxToTokenRate = rateAmounts[1];
                } catch (e) {}

                const gasCostInToken = (gasCostInAvax * wavaxToTokenRate) / ethers.parseUnits("1.0", 18);
                const netProfit = grossProfit - gasCostInToken;

                const minNetProfitThreshold = token.name === "JOE" ? ethers.parseUnits("0.1", token.decimals) : ethers.parseUnits("0.02", token.decimals);

                if (netProfit > minNetProfitThreshold) {
                    const alertText =
                        `🚀 *Baran Multi-Pair Signal (${token.name})!*\n\n` +
                        `📍 *Route:* ${executionRoute}\n` +
                        `💰 *Gross Spread:* ${ethers.formatUnits(grossProfit, token.decimals)} ${token.name}\n` +
                        `⛽ *Gas Cost:* ${ethers.formatUnits(gasCostInToken, token.decimals)} ${token.name}\n` +
                        `✨ *Net Profit:* \`${ethers.formatUnits(netProfit, token.decimals)} ${token.name}\`\n` +
                        `🌐 *Network:* Avalanche C-Chain`;

                    console.log(alertText);
                    await sendTelegramAlert(alertText);
                }
            } catch (errToken) {
                // استمرار المسح للأزواج الأخرى في حال حدوث خطأ عابر في زوج معين
            }
        }

        console.log("Scanning block across all target pairs... Engine operating smoothly.");

    } catch (error) {
        console.error("Scanner Loop Error:", error.message);
    }
}

console.log("Baran Multi-Pair Micro-Engine Activated. Parallel scanning enabled.");
setInterval(scanMarketOpportunities, 4000);