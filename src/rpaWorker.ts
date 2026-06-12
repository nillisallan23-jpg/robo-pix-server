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
    console.error(`[CRITICAL] Falha ao registrar log:`, error.message);
  }
}

async function atualizarStatusBanco(id: string, novoStatus: string, qrCodeUrl: string | null = null) {
  const body: any = { status: novoStatus };
  if (qrCodeUrl) body.qr_code_url = qrCodeUrl;
  
  await axios.patch(`${SUPABASE_URL}/rest/v1/robo_bancos_config?id=eq.${id}`, body, {
    headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' }
  });
}

async function buscarBancosPendentes() {
  try {
    const { data } = await axios.get(`${SUPABASE_URL}/rest/v1/robo_bancos_config?status=eq.pendente`, {
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
    });
    return data;
  } catch (error: any) {
    console.error("[CRITICAL] Erro ao buscar pendentes:", error.message);
    return [];
  }
}

export async function executarRobo() {
  if (isExecuting) return;
  isExecuting = true;
  
  const pendencias = await buscarBancosPendentes();
  
  for (const banco of pendencias) {
    // Mapeamento de segurança (ajuste conforme o nome real das colunas no seu banco)
    const nomeBanco = banco.nome_banco || banco.nomeBanco || 'Banco Desconhecido';
    const urlLogin = banco.url_login || banco.urlLogin || '';

    await registrarLog('INFO', `Iniciando autorização para: ${nomeBanco}`);
    
    // Validação estrita da URL
    if (!urlLogin || !urlLogin.startsWith('http')) {
      await registrarLog('ERRO', `Falha em ${nomeBanco}: URL inválida ou ausente (${urlLogin}).`);
      await atualizarStatusBanco(banco.id, 'erro');
      continue; 
    }

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
        const elementoAlvo = elementos.find(el => 
          palavrasChave.some(texto => el.textContent?.includes(texto) || (el as HTMLImageElement).alt?.includes(texto))
        );
        return (elementoAlvo as HTMLAnchorElement)?.href || (elementoAlvo as HTMLImageElement)?.src;
      });

      if (!linkAutenticacao) throw new Error("Não foi possível encontrar o botão de autorização.");
      
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
  isExecuting = false;
}

console.log("[RPA] Serviço inicializado.");
setInterval(() => { console.log(`[HEARTBEAT] Executando: ${isExecuting}`); }, 60000);
setInterval(executarRobo, 5000);
executarRobo();