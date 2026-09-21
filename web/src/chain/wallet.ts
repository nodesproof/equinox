// wallet.ts — wallet injected (MetaMask) di Arbitrum Sepolia: connect, pastikan chain, simulate → write → tunggu receipt, dekode revert.
import {
  BaseError, ContractFunctionRevertedError, WaitForTransactionReceiptTimeoutError, createWalletClient, custom, getAddress, type Address, type Hash,
} from 'viem';
import { chain, client } from './client';
import type { PoolKey } from '../deployment';
import { MAX_UINT, REVERT_TEXT, poolCall, type TradeCall } from './trade';

/** Selector error yang tidak ada di ABI pool tetapi bisa menggelembung dari kontrak lain yang dipanggil pool: token ERC-1155 saat close/claim, dan
 *  USDG Paxos (Pool C) saat buy/deposit — token itu memakai error tanpa argumen `InsufficientFunds()` / `InsufficientAllowance()`, bukan
 *  `ERC20InsufficientBalance/Allowance` OpenZeppelin seperti MockUSDG (verifikasi: `cast sig "InsufficientFunds()"` → 0x356680b7, `InsufficientAllowance()` → 0x13be252b). */
export const REVERT_SELECTOR: Record<string, string> = {
  '0x03dee4c5': 'ERC1155InsufficientBalance', '0x356680b7': 'InsufficientFunds', '0x13be252b': 'InsufficientAllowance',
};
/** Tx yang sudah terkirim tetapi gagal (status 0), belum terkonfirmasi sampai timeout, atau receipt-nya gagal dibaca — hash disimpan agar log tetap punya tautan explorer. */
export class TxFailed extends Error {
  constructor(message: string, readonly hash: Hash) { super(message); this.name = 'TxFailed'; }
}

export function hasWallet(): boolean { return typeof window !== 'undefined' && !!window.ethereum; }
export function walletClient() {
  if (!hasWallet()) throw new Error('No injected wallet (MetaMask) found');
  return createWalletClient({ chain, transport: custom(window.ethereum as never) });
}
export async function connect(): Promise<Address> {
  const [a] = await walletClient().requestAddresses();
  if (!a) throw new Error('No account');
  await ensureChain();
  return a;
}
/** Kode EIP-1193 dari error viem (RpcError.code) atau objek provider mentah. */
function rpcCode(e: unknown): number | undefined {
  const code = (x: unknown) => (x && typeof x === 'object' && typeof (x as { code?: unknown }).code === 'number' ? (x as { code: number }).code : undefined);
  if (e instanceof BaseError) { const hit = e.walk((x) => code(x) !== undefined); return code(hit); }
  return code(e);
}
/** Pindah ke Arbitrum Sepolia. 4902 (chain tak dikenal) → tambahkan lalu pindah; 4001 (ditolak) → pesan tanpa prompt lanjutan; lainnya diteruskan. */
export async function ensureChain(): Promise<void> {
  const w = walletClient();
  const id = await w.getChainId();
  if (id === chain.id) return;
  try { await w.switchChain({ id: chain.id }); }
  catch (e) {
    const code = rpcCode(e);
    if (code === 4902) { await w.addChain({ chain }); await w.switchChain({ id: chain.id }); return; }
    if (code === 4001) throw new Error('Switch to Arbitrum Sepolia to continue');
    throw e;
  }
}
/** Nama custom error dari ABI (atau selector yang dikenal) → pesan manusiawi (REVERT_TEXT); selain itu shortMessage viem (mis. "User rejected the request."). */
export function decodeRevert(e: unknown): string {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (r) {
      const name = r.data?.errorName ?? (r.signature ? REVERT_SELECTOR[r.signature] : undefined);
      if (name) return REVERT_TEXT[name] ?? `Reverted: ${name}`;
      if (r.reason) return `Reverted: ${r.reason}`;
      if (r.signature) return `Reverted: ${r.signature}`;
    }
    return e.shortMessage;
  }
  return e instanceof Error ? e.message : String(e);
}
/** Premi yang benar-benar dibayar `buy(id, size)` dari `account` = hasil `simulateContract` `buy(id, size, MAX_UINT)` (nilai kembalian `premiumAssets`).
 *  `buy` memanggil `_pokeVol()` sebelum menghitung harga, jadi eksekusi memakai σ pada round Chainlink TERBARU; `quoteBuy` (view) memakai round
 *  terakhir yang sudah diobservasi engine — bila engine lama tidak di-poke, batas 1 % dari kuotasi view gagal `SlippageExceeded` (I-1).
 *  Revert (allowance/saldo/SeriesExpired/…) dilempar apa adanya — pemanggil mendekode lewat `decodeRevert`. */
export async function executedBuy(k: PoolKey, id: bigint, size: bigint, account: Address): Promise<bigint> {
  const { result } = await client.simulateContract({ ...poolCall(k), functionName: 'buy', args: [id, size, MAX_UINT], account });
  return result;
}
/** Proceeds yang benar-benar diterima `close(id, size)` dari `account` = hasil simulasi `close(id, size, 0)` (alasan yang sama dengan `executedBuy`). */
export async function executedClose(k: PoolKey, id: bigint, size: bigint, account: Address): Promise<bigint> {
  const { result } = await client.simulateContract({ ...poolCall(k), functionName: 'close', args: [id, size, 0n], account });
  return result;
}
/** simulate (eth_call lewat RPC publik, revert didekode sebelum popup wallet) → write lewat wallet → tunggu receipt; mengembalikan hash. */
export async function write(call: TradeCall, account: Address): Promise<Hash> {
  await ensureChain();
  const { request } = await client.simulateContract({ ...call, account });
  // Gas dipad 1,5× — aturan yang sama dengan tools/sepolia/lib.sh send() dan smoke test: estimasi Nitro hanya bermargin ~2–3 %, dan round Chainlink
  // yang masuk di antara estimasi dan inklusi menambah SSTORE observe engine lewat _pokeVol. Estimasi gagal → biarkan wallet mengestimasi sendiri.
  let gas: bigint | undefined;
  try { gas = ((await client.estimateContractGas({ ...call, account })) * 3n) / 2n; } catch { /* biarkan wallet mengestimasi */ }
  const hash = await walletClient().writeContract({ ...request, gas });
  let status: 'success' | 'reverted';
  try { status = (await client.waitForTransactionReceipt({ hash })).status; }
  catch (e) {
    if (e instanceof WaitForTransactionReceiptTimeoutError) throw new TxFailed('Transaction not confirmed within 3 minutes — check it on the explorer', hash);
    // Error lain saat menunggu receipt (RPC putus/429, blok tak ditemukan) — tx-nya mungkin sudah masuk; simpan hash agar log tetap punya tautan explorer.
    throw new TxFailed(`Receipt lookup failed (${decodeRevert(e)}) — check it on the explorer`, hash);
  }
  if (status !== 'success') throw new TxFailed('Transaction reverted on-chain (status 0)', hash);
  return hash;
}
/** Pendengar EIP-1193: MetaMask memancarkan `accountsChanged([])` saat disconnect dan `chainChanged(hexId)` saat jaringan berganti.
 *  Mengembalikan fungsi pelepas (`removeListener` bila provider menyediakannya; no-op selain itu) — dipakai cleanup efek React agar
 *  StrictMode dev / remount tidak menumpuk pendengar; panel klasik (`panels/trade.ts`) mengabaikan nilai kembaliannya. */
export function onWalletEvents(h: { accounts(a: Address[]): void; chain(id: number): void }): () => void {
  const eth = typeof window !== 'undefined' ? window.ethereum : undefined;
  if (!eth?.on) return () => {};
  const onAccounts = (a: unknown) => h.accounts(((a as string[]) ?? []).map((x) => getAddress(x)));
  const onChain = (id: unknown) => h.chain(Number(id));
  eth.on('accountsChanged', onAccounts);
  eth.on('chainChanged', onChain);
  return () => { eth.removeListener?.('accountsChanged', onAccounts); eth.removeListener?.('chainChanged', onChain); };
}
