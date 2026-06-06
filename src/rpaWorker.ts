import puppeteer from 'puppeteer';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

// ID fixo do heartbeat com os 36 caracteres completos para o UUID do banco
const HEARTBEAT_ID = '00000000-0000-0000-0000-000000000000';

// Trava de segurança para evitar execuções sobrepostas
let isExecuting = false;

/**
 * Envia os logs de execução direto para a tabela do Supabase
 */
async function registrarLog(level: 'INFO' | 'SUCESSO' | 'ERRO', message: string) {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`[RPA] [${timestamp}] [${level}] ${message}`);

  try {
    await axios.post(
      `${SUPABASE_URL}/rest/v1/robo_logs`,
      {
        level: level,
        message: `[${timestamp}] ${message}`,
        contexto: {}
      },
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
    console.error(`[RPA ERR] Erro ao persistir log no Supabase:`, error.message);
  }
}

/**
 * Atualiza o status do robô usando um UPDATE seguro via API do Supabase
 */
async function enviarHeartbeat(status: string) {
  try {
    await axios.patch(
      `${SUPABASE_URL}/rest/v1/robo_heartbeat?id=eq.${HEARTBEAT_ID}`,
      {
        status_atual: status,
        ultima_atividade: new Date().toISOString()
      },
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
    console.error(`[RPA ERR] Erro ao enviar Heartbeat:`, error.message);
  }
}

export async function executarRobo() {
  if (isExecuting) {
    await registrarLog('INFO', 'Varredura já em andamento. Pulando este ciclo.');
    return;
  }

  isExecuting = true;
  await enviarHeartbeat('executando');
  await registrarLog('INFO', 'Iniciando ciclo de varredura nos bancos...');

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    await registrarLog('INFO', 'Navegador Puppeteer aberto com sucesso.');
    await registrarLog('SUCESSO', 'Varredura de teste concluída. Painel conectado.');

  } catch (error: any) {
    await registrarLog('ERRO', `Falha na execução do robô: ${error.message}`);
    await enviarHeartbeat('erro');
  } finally {
    if (browser) {
      await browser.close();
      await registrarLog('INFO', 'Navegador fechado. Aguardando próxima chamada.');
    }
    isExecuting = false;
    await enviarHeartbeat('online');
  }
}

// Executa imediatamente ao iniciar o worker de forma independente
if (require.main === module) {
  console.log("[RPA] Módulo do Robô Extrator ativo de forma independente.");
  executarRobo();
  // Mantém o processo rodando a cada 30 segundos para teste
  setInterval(executarRobo, 30000);
}