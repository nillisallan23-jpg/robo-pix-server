"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.executarRobo = executarRobo;
const puppeteer_1 = __importDefault(require("puppeteer"));
const axios_1 = __importDefault(require("axios"));
const dotenv_1 = __importDefault(require("dotenv"));
const qrcode_1 = __importDefault(require("qrcode"));
dotenv_1.default.config();
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
let isExecuting = false;
async function registrarLog(level, message) {
    const timestamp = new Date().toLocaleTimeString();
    const msgFormatada = `[${timestamp}] ${message}`;
    console.log(`[RPA] [${level}] ${msgFormatada}`);
    try {
        await axios_1.default.post(`${SUPABASE_URL}/rest/v1/robo_logs`, { level, message: msgFormatada, contexto: {} }, {
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            }
        });
    }
    catch (error) {
        console.error(`[CRITICAL] Falha ao enviar log: ${error.message}`);
    }
}
async function atualizarStatusBanco(id, novoStatus, qrCodeUrl = null) {
    try {
        const body = { status: novoStatus };
        if (qrCodeUrl)
            body.qr_code_url = qrCodeUrl;
        await axios_1.default.patch(`${SUPABASE_URL}/rest/v1/robo_bancos_config?id=eq.${id}`, body, {
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json',
                'Accept-Profile': 'public'
            }
        });
    }
    catch (error) {
        console.error(`[CRITICAL] Falha ao atualizar status: ${error.message}`);
    }
}
async function buscarBancosPendentes() {
    const url = `${SUPABASE_URL}/rest/v1/robo_bancos_config`;
    try {
        const response = await axios_1.default.get(url, {
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json',
                'Accept-Profile': 'public'
            },
            timeout: 10000
        });
        return response.data || [];
    }
    catch (error) {
        console.error(`[CRITICAL] Erro na requisição:`, error.message);
        return [];
    }
}
async function executarRobo() {
    if (isExecuting)
        return;
    isExecuting = true;
    try {
        const todosOsBancos = await buscarBancosPendentes();
        // FILTRO ATUALIZADO: Aceita 'pendente' OU 'processando'
        const pendencias = todosOsBancos.filter((b) => {
            const s = String(b.status).trim();
            return s === 'pendente' || s === 'processando';
        });
        console.log(`[DEBUG] Bancos encontrados para processar: ${pendencias.length}`);
        for (const banco of pendencias) {
            const nomeBanco = banco.banco_nome || banco.nome_banco || 'Banco Desconhecido';
            const urlLogin = banco.url_login || banco.urlLogin || '';
            if (!urlLogin || !urlLogin.startsWith('http')) {
                await registrarLog('ERRO', `Banco ${nomeBanco} ignorado: URL inválida (${urlLogin})`);
                await atualizarStatusBanco(banco.id, 'erro');
                continue;
            }
            await registrarLog('INFO', `Iniciando processamento: ${nomeBanco}`);
            await atualizarStatusBanco(banco.id, 'processando');
            let browser;
            try {
                browser = await puppeteer_1.default.launch({
                    headless: true,
                    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote', '--single-process']
                });
                const page = await browser.newPage();
                await page.setDefaultNavigationTimeout(30000);
                await page.goto(urlLogin, { waitUntil: 'networkidle2' });
                const linkAutenticacao = await page.evaluate(() => {
                    const palavrasChave = ['Autorizar', 'Conectar', 'Confirmar', 'QR Code', 'Acesso'];
                    const elementos = Array.from(document.querySelectorAll('a, button, div, img'));
                    const alvo = elementos.find(el => palavrasChave.some(t => el.textContent?.includes(t)));
                    return alvo?.href || alvo?.src;
                });
                if (!linkAutenticacao)
                    throw new Error("Botão não encontrado na página.");
                const qrCodeBase64 = await qrcode_1.default.toDataURL(linkAutenticacao);
                await registrarLog('SUCESSO', `QR Code gerado para ${nomeBanco}.`);
                await atualizarStatusBanco(banco.id, 'aguardando_leitura', qrCodeBase64);
            }
            catch (error) {
                await registrarLog('ERRO', `Falha em ${nomeBanco}: ${error.message}`);
                await atualizarStatusBanco(banco.id, 'erro');
            }
            finally {
                if (browser)
                    await browser.close();
            }
        }
    }
    catch (err) {
        console.error("[CRITICAL] Erro inesperado:", err);
    }
    finally {
        isExecuting = false;
    }
}
console.log("[RPA] Serviço inicializado.");
setInterval(() => { console.log(`[HEARTBEAT] Executando: ${isExecuting}`); }, 60000);
setInterval(executarRobo, 5000);
executarRobo();
