import puppeteer from 'puppeteer';
import axios from 'axios';
import dotenv from 'dotenv';
import QRCode from 'qrcode';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
let isExecuting = false;

// Função de log blindada
async function registrarLog(level: 'INFO' | 'SUCESSO' | 'ERRO', message: string) {
  const timestamp = new Date().toLocaleTimeString();
  const msgFormatada = `[${timestamp}] ${message}`;
  console.log(`[RPA] [${level}] ${msgFormatada}`);
  
  try {
    await axios.post(`${SUPABASE_URL}/rest/v1/robo_logs`, 
      { level, message: msgFormatada, contexto: {} }, 
      {
        headers: { 
          'apikey': SUPABASE_ANON_KEY, 
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 
          'Content-Type': 'application/json', 
          'Prefer': 'return=minimal' 
        }
      }
    );
  } catch (error: any) { 
    console.error(`[CRITICAL] Falha ao enviar log para Supabase: ${error.message}`);
  }
}

async function atualizarStatusBanco(id: string, novoStatus: string, qrCodeUrl: string | null = null) {
  try {
    const body: any = { status: novoStatus };
    if (qrCodeUrl) body.qr_code_url = qrCodeUrl;
    
    await axios.patch(`${SUPABASE_URL}/rest/v1/robo_bancos_config?id=eq.${id}`, body, {
      headers: { 
        'apikey': SUPABASE_ANON_KEY, 
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 
        'Content-Type': 'application/json',
        'Accept-Profile': 'public'
      }
    });
  } catch (error: any) {
    console.error(`[CRITICAL] Falha ao atualizar status: ${error.message}`);
  }
}

// BUSCA SEM FILTRO PARA TESTE
async function buscarBancosPendentes() {
  const url = `${SUPABASE_URL}/rest/v1/robo_bancos_config`; // URL SEM O FILTRO ?status=eq.pendente
  console.log(`[DEBUG] Tentando buscar tudo em: ${url}`);
  
  try {
    const response = await axios.get(url, {
      headers: { 
        'apikey': SUPABASE_ANON_KEY, 
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Accept-Profile': 'public'
      },
      timeout: 10000 
    });
    
    console.log(`[DEBUG] Conexão bem-sucedida! Bancos totais encontrados: ${response.data?.length}`);
    return response.data || [];
  } catch (error: any) {
    console.error(`[CRITICAL] Erro na busca sem filtro:`, error.message);
    return [];
  }
}

export async function executarRobo() {
  if (isExecuting) return;
  isExecuting = true;
  
  try {
    const bancos = await buscarBancosPendentes();
    
    // Filtro manual no código para garantir que só pegamos os "pendentes"
    const pendencias = bancos.filter((b: any) => b.status === 'pendente');
    console.log(`[DEBUG] Após filtro manual, bancos pendentes: ${pendencias.length}`);
    
    for (const banco of pendencias) {
      const nomeBanco = banco.banco_nome || banco.nome_banco || banco.nomeBanco || 'Banco Desconhecido';
      const urlLogin = banco.url_login || banco.urlLogin || '';

      if (!urlLogin || !urlLogin.startsWith('http')) {
        await registrarLog('ERRO', `Banco ${nomeBanco} ignorado: URL inválida (${urlLogin})`);
        continue;
      }

      await registrarLog('INFO', `Iniciando: ${nomeBanco}`);
      await atualizarStatusBanco(banco.id, 'processando');
      
      // ... (Restante da lógica do Puppeteer mantida igual)
      // O código Puppeteer continua igual ao que você já tem...
    }
  } catch (err) {
    console.error("[CRITICAL] Erro inesperado:", err);
  } finally {
    isExecuting = false;
  }
}

console.log("[RPA] Serviço inicializado com sucesso.");
setInterval(() => { console.log(`[HEARTBEAT] Executando: ${isExecuting}`); }, 60000);
setInterval(executarRobo, 5000);
executarRobo();