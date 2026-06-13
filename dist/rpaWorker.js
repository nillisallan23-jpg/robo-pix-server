"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.executarRobo = executarRobo;
const axios_1 = __importDefault(require("axios"));
const dotenv_1 = __importDefault(require("dotenv"));
const puppeteer_1 = __importDefault(require("puppeteer"));
dotenv_1.default.config();
const supabase = axios_1.default.create({
    baseURL: process.env.SUPABASE_URL,
    headers: {
        'apikey': process.env.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
    },
    timeout: 15000
});
let isExecuting = false;
async function atualizarStatus(id, status, extra = {}) {
    try {
        await supabase.patch(`/rest/v1/robo_bancos_config?id=eq.${id}`, { status, ...extra, updated_at: new Date().toISOString() });
        console.log(`[LOG] Status do banco ${id} atualizado para: ${status}`);
    }
    catch (e) {
        console.error(`[ERRO] Falha ao atualizar status do banco ${id}:`, e.message);
    }
}
async function executarRobo() {
    if (isExecuting)
        return;
    isExecuting = true;
    try {
        const { data: todosOsBancos } = await supabase.get('/rest/v1/robo_bancos_config');
        const pendencias = (todosOsBancos || []).filter((b) => ['pendente', 'erro'].includes(String(b.status).trim().toLowerCase()));
        console.log(`[LOG] Bancos encontrados para processar: ${pendencias.length}`);
        for (const banco of pendencias) {
            console.log(`[DEBUG] Processando Banco ID: ${banco.id} | Status: ${banco.status}`);
            if (!banco.url_login) {
                console.warn(`[WARN] Banco ${banco.id} sem url_login. Marcando como erro.`);
                await atualizarStatus(banco.id, 'erro');
                continue;
            }
            let browser;
            try {
                browser = await puppeteer_1.default.launch({
                    headless: true,
                    args: ['--no-sandbox', '--disable-setuid-sandbox']
                });
                const page = await browser.newPage();
                await page.setViewport({ width: 1280, height: 800 });
                console.log(`[NAV] Navegando para: ${banco.url_login}`);
                await page.goto(banco.url_login, {
                    waitUntil: 'networkidle2',
                    timeout: 30000
                });
                console.log(`[OK] Página carregada para banco ${banco.id}`);
                await atualizarStatus(banco.id, 'aguardando_leitura');
            }
            catch (navErr) {
                console.error(`[ERRO] Falha na navegação do banco ${banco.id}:`, navErr.message);
                await atualizarStatus(banco.id, 'erro');
            }
            finally {
                if (browser) {
                    try {
                        await browser.close();
                    }
                    catch (closeErr) {
                        console.error(`[ERRO] Falha ao fechar browser do banco ${banco.id}:`, closeErr.message);
                    }
                }
            }
        }
    }
    catch (err) {
        console.error('[ERRO] Falha no ciclo:', err.message);
    }
    finally {
        isExecuting = false;
    }
}
setInterval(executarRobo, 10000);
executarRobo();
