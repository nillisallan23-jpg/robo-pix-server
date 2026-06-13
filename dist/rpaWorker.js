"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.executarRobo = executarRobo;
const axios_1 = __importDefault(require("axios"));
const dotenv_1 = __importDefault(require("dotenv"));
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
            // Aqui o robô processaria...
        }
    }
    catch (err) {
        console.error("[ERRO] Falha no ciclo:", err.message);
    }
    finally {
        isExecuting = false;
    }
}
setInterval(executarRobo, 10000);
executarRobo();
