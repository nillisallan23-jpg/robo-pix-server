import puppeteer from 'puppeteer';
import axios from 'axios';
import dotenv from 'dotenv';
import QRCode from 'qrcode';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
let isExecuting = false;

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
    console.error(`[CRITICAL] Falha ao enviar log: ${error.message}`);
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

async function buscarBancosPendentes() {
  const url = `${SUPABASE_URL}/rest/v1/robo_bancos_config`; 
  
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
    
    return response.data || [];
  } catch (error: any) {
    console.error(`[CRITICAL] Erro na requisição:`, error.message);
    return [];
  }
}

export async function executarRobo() {
  if (isExecuting) return;
  isExecuting = true;
  
  try {
    const todosOsBancos = await buscarBancosPendentes();
    
    // FILTRO ATUALIZADO: Aceita 'pendente' OU 'processando'
    const pendencias = todosOsBancos.filter((b: any) => {
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
        browser = await puppeteer.launch({ 
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
          return (alvo as HTMLAnchorElement)?.href || (alvo as HTMLImageElement)?.src;
        });

        if (!linkAutenticacao) throw new Error("Botão não encontrado na página.");
        
        const qrCodeBase64 = await QRCode.toDataURL(linkAutenticacao);
        await registrarLog('SUCESSO', `QR Code gerado para ${nomeBanco}.`);
        await atualizarStatusBanco(banco.id, 'aguardando_leitura', qrCodeBase64);
        
      } catch (error: any) {
        await registrarLog('ERRO', `Falha em ${nomeBanco}: ${error.message}`);
        await atualizarStatusBanco(banco.id, 'erro');
      } finally {
        if (browser) await browser.close();
      }
    }
  } catch (err) {
    console.error("[CRITICAL] Erro inesperado:", err);
  } finally {
    isExecuting = false;
  }
}

console.log("[RPA] Serviço inicializado.");
setInterval(() => { console.log(`[HEARTBEAT] Executando: ${isExecuting}`); }, 60000);
setInterval(executarRobo, 5000);
executarRobo();