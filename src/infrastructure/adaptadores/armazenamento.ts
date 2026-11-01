import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ErroDominio } from '../../domain/types.ts';
import { ErroIntegracao } from '../../application/adaptadores.ts';
import type { AdaptadorArmazenamento, MetadadosArquivo } from '../../application/adaptadores.ts';
import { ArmazenamentoExterno, FalhaExterna } from '../sistemas-externos.ts';

export const TAMANHO_MAXIMO_ARQUIVO = 25 * 1024 * 1024;
const SEGMENTO = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,120}$/;

/** Nome portável em Windows e Linux: sem acentos, separadores ou caracteres reservados. */
export function nomeSeguro(nome: string): string {
  const limpo = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+/, '').slice(0, 120);
  return limpo || 'arquivo';
}

/** Pasta lógica com segmentos seguros, sempre terminada por "/" (ou vazia). */
export function normalizarPrefixo(prefixo = ''): string {
  if (prefixo === '') return '';
  const segmentos = prefixo.replace(/\/+$/, '').split('/');
  if (!segmentos.every(s => SEGMENTO.test(s))) throw new ErroDominio('Prefixo de arquivo inválido.', 400);
  return `${segmentos.join('/')}/`;
}

function validarEntrada(conteudo: Buffer, metadados: MetadadosArquivo): void {
  if (!Buffer.isBuffer(conteudo) || conteudo.length === 0) throw new ErroDominio('O arquivo está vazio.', 400);
  if (conteudo.length > TAMANHO_MAXIMO_ARQUIVO) throw new ErroDominio('O arquivo excede 25 MiB.', 413);
  if (typeof metadados?.nome !== 'string' || !metadados.nome.trim()) throw new ErroDominio('Informe o nome do arquivo.', 400);
}

function traduzirFalha(provedor: string, erro: unknown): never {
  if (erro instanceof FalhaExterna) {
    if (erro.codigo === '404') throw new ErroIntegracao('Arquivo não encontrado no provedor.', 404);
    if (erro.codigo === '503') throw new ErroIntegracao(`Armazenamento ${provedor} indisponível.`, 503);
    throw new ErroIntegracao(`O armazenamento ${provedor} recusou a operação: ${erro.message}.`);
  }
  throw erro;
}

/** Base dos provedores de objetos: traduz Buffer/metadados em File e chaves em URIs do provedor. */
abstract class AdaptadorObjetos implements AdaptadorArmazenamento {
  abstract readonly provedor: string;
  protected abstract readonly esquema: string;
  protected readonly externo: ArmazenamentoExterno;
  constructor(externo: ArmazenamentoExterno) { this.externo = externo; }
  protected abstract chave(prefixo: string, nome: string): string;
  private uri(chave: string): string { return `${this.esquema}://${this.externo.bucket}/${chave}`; }

  async salvarArquivo(conteudo: Buffer, metadados: MetadadosArquivo): Promise<string> {
    validarEntrada(conteudo, metadados);
    const arquivo = new File([new Uint8Array(conteudo)], this.chave(normalizarPrefixo(metadados.prefixo), nomeSeguro(metadados.nome)),
      { type: metadados.tipo ?? 'application/octet-stream' });
    try { return this.uri(await this.externo.upload(arquivo)); } catch (erro) { return traduzirFalha(this.provedor, erro); }
  }
  async recuperarArquivo(id: string): Promise<Buffer> {
    const inicio = `${this.esquema}://${this.externo.bucket}/`;
    if (typeof id !== 'string' || !id.startsWith(inicio)) throw new ErroIntegracao(`Identificador não pertence ao armazenamento ${this.provedor}.`, 400);
    try { return Buffer.from(await (await this.externo.download(id.slice(inicio.length))).arrayBuffer()); }
    catch (erro) { return traduzirFalha(this.provedor, erro); }
  }
  async listarArquivos(prefixo: string): Promise<string[]> {
    try { return (await this.externo.listar(normalizarPrefixo(prefixo))).map(chave => this.uri(chave)); }
    catch (erro) { return traduzirFalha(this.provedor, erro); }
  }
}

/** Amazon S3: identificadores `s3://bucket/chave`; um UUID evita sobrescrever arquivos homônimos. */
export class AdaptadorS3 extends AdaptadorObjetos {
  readonly provedor = 's3';
  protected readonly esquema = 's3';
  protected chave(prefixo: string, nome: string): string { return `${prefixo}${randomUUID()}/${nome}`; }
}

/** Google Cloud Storage: identificadores `gs://bucket/objeto`, com geração no nome do objeto. */
export class AdaptadorGoogleCloud extends AdaptadorObjetos {
  readonly provedor = 'gcs';
  protected readonly esquema = 'gs';
  protected chave(prefixo: string, nome: string): string { return `${prefixo}${Date.now()}-${randomUUID().slice(0, 8)}-${nome}`; }
}

/** Disco local, sem sistema externo. Identificadores `local://caminho` com barras normais em qualquer SO. */
export class AdaptadorLocal implements AdaptadorArmazenamento {
  readonly provedor = 'local';
  private raiz: string;
  constructor(diretorio: string) { this.raiz = path.resolve(diretorio); }
  private caminho(relativo: string): string {
    const segmentos = relativo.split('/');
    if (!segmentos.every(s => SEGMENTO.test(s))) throw new ErroIntegracao('Identificador de arquivo local inválido.', 400);
    const absoluto = path.join(this.raiz, ...segmentos);
    // Defesa adicional contra travessia de diretórios.
    if (!absoluto.startsWith(this.raiz + path.sep)) throw new ErroIntegracao('Identificador de arquivo local inválido.', 400);
    return absoluto;
  }
  async salvarArquivo(conteudo: Buffer, metadados: MetadadosArquivo): Promise<string> {
    validarEntrada(conteudo, metadados);
    const relativo = `${normalizarPrefixo(metadados.prefixo)}${randomUUID()}-${nomeSeguro(metadados.nome)}`;
    const destino = this.caminho(relativo);
    await mkdir(path.dirname(destino), { recursive: true });
    await writeFile(destino, conteudo, { flag: 'wx' });
    return `local://${relativo}`;
  }
  async recuperarArquivo(id: string): Promise<Buffer> {
    if (typeof id !== 'string' || !id.startsWith('local://')) throw new ErroIntegracao('Identificador não pertence ao armazenamento local.', 400);
    try { return await readFile(this.caminho(id.slice('local://'.length))); }
    catch (erro) {
      if ((erro as NodeJS.ErrnoException).code === 'ENOENT') throw new ErroIntegracao('Arquivo não encontrado no provedor.', 404);
      throw erro;
    }
  }
  async listarArquivos(prefixo: string): Promise<string[]> {
    const pasta = normalizarPrefixo(prefixo);
    let entradas;
    try { entradas = await readdir(this.raiz, { recursive: true, withFileTypes: true }); }
    catch (erro) { if ((erro as NodeJS.ErrnoException).code === 'ENOENT') return []; throw erro; }
    return entradas.filter(e => e.isFile())
      .map(e => path.relative(this.raiz, path.join(e.parentPath, e.name)).split(path.sep).join('/'))
      .filter(relativo => relativo.startsWith(pasta)).sort().map(relativo => `local://${relativo}`);
  }
}
