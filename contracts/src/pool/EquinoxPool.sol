// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC4626, IERC20, IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable, Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { IAggregatorV3 } from "../interfaces/IAggregatorV3.sol";
import { IBlackScholes } from "../interfaces/IBlackScholes.sol";
import { OracleLib } from "../oracle/OracleLib.sol";
import { EquinoxOptionToken } from "./EquinoxOptionToken.sol";
import { EquinoxVolEngine } from "./EquinoxVolEngine.sol";

/// @title EquinoxPool — vault ERC-4626 atas USDG yang menjual opsi ETH Eropa cash-settled (§8.4).
/// @notice Harga sepenuhnya on-chain: σ dari EquinoxVolEngine, Black-Scholes dari `math` (Stylus atau kontrol Solidity —
///         pool tidak tahu bedanya). Solvabilitas keras: `reserved = Σ OI × K` ≤ aset; call dibayar `min(S_T − K, K)`.
/// @dev Akuntansi internal dalam WAD (1e18); konversi ke desimal aset hanya di boundary transfer (FR-35):
///      premi dibulatkan ke atas, proceeds/payout ke bawah. Ukuran opsi (`size`) dalam WAD unit (1e18 = 1 ETH).
contract EquinoxPool is ERC4626, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- tipe
    struct Config {
        uint16 feeBps;          // fee atas premi → treasury (≤ 1000)
        uint16 maxUtilBps;      // reserved ≤ maxUtil × (cash − escrow) (≤ 9000)
        uint16 vegaCapBps;      // vegaCap = (cash − escrow) × bps/1e4, per 1,00 vol (≤ 5000)
        uint16 minPremiumBps;   // premi ≥ bps × K × size (≤ 100)
        uint32 heartbeat;       // detik
        uint8 staleMult;        // kuotasi revert bila umur spot > heartbeat × staleMult (≥ 1)
        uint32 sequencerGrace;  // detik setelah sequencer kembali
        uint8 maxOpenSeries;    // ≤ 32 (batas loop MtM / markPortfolio)
        uint32 tenorMax;        // detik (≤ 90 hari)
        uint128 minSize;        // WAD unit
        uint128 settleBounty;   // unit aset (mis. 2e6 = 2 USDG)
    }

    struct Series {
        uint32 boardId;
        uint64 expiry;
        uint128 strike;        // WAD
        bool isCall;
        bool settled;
        uint256 oi;            // WAD unit
        uint256 vegaAcc;       // Σ vega yang dibukukan saat trade (WAD per 1,00 vol)
        uint256 payoutPerUnit; // WAD USDG, diisi saat settle
    }

    struct Board {
        uint64 expiry;
        bool settled;
        uint256 settlementPrice; // WAD
        uint256[] seriesIds;
    }

    struct Deploy {
        address owner;
        address usdg;
        address feed;
        address sequencerFeed; // address(0) = tanpa cek sequencer
        address math;
        address treasury;
        Config cfg;
        EquinoxVolEngine.Params vol;
        uint256 sigmaSeed; // WAD
        int256 rWad;       // suku bunga (WAD), default 0
        string name;
        string symbol;
    }

    // ---------------------------------------------------------------- konstanta & immutables
    uint256 private constant WAD = 1e18;
    uint256 private constant SECONDS_PER_YEAR = 31_536_000;
    uint256 private constant T_MIN = 60;                 // detik; domain math (§6.6)
    uint256 private constant FRIDAY_0800 = 115_200;      // 1970-01-02 08:00 UTC
    uint256 private constant WEEK = 604_800;
    uint256 public constant CAP_MULT = 2e18;             // payout call dibatasi K (cap = 2K)

    IBlackScholes public immutable math;
    IAggregatorV3 public immutable feed;
    IAggregatorV3 public immutable sequencerFeed;
    EquinoxOptionToken public immutable token;
    EquinoxVolEngine public immutable vol;
    uint256 public immutable priceScale;  // 10^(18 − feed.decimals())
    uint256 public immutable assetScale;  // 10^(18 − asset.decimals())
    int256 public immutable rWad;

    // ---------------------------------------------------------------- state
    Config public cfg;
    address public treasury;
    bool public tradingPaused;
    uint256 public reserved;         // WAD USDG: Σ OI × K seri terbuka
    uint256 public escrowedPayouts;  // WAD USDG: payout pasti menunggu claim
    uint256 public netVega;          // WAD per 1,00 vol
    /// @notice Referensi kapital yang di-lag untuk util/cap (bukan untuk NAV atau withdraw). `capitalRefPrev` adalah
    ///         snapshot kapital dari sebelum jendela `CAPITAL_REF_DELAY` saat ini; `_capitalForCaps` memakai
    ///         `min(live, capitalRefPrev)`, sehingga deposit baru baru "dihitung" oleh util/vegaCap setelah usianya
    ///         ≥ CAPITAL_REF_DELAY. Tanpa ini, deposit besar bisa mengencerkan util secara instan lalu buy murah/close
    ///         mahal di blok yang sama (R2-a) — penarikan tetap dihitung segera lewat sisi `live` dari `min`.
    uint256 public capitalRefPrev;
    uint256 public capitalRefCur;
    uint64 public capitalRefAt;
    uint64 public constant CAPITAL_REF_DELAY = 1 days;
    mapping(uint256 => Series) public series;
    Board[] internal _boards;
    uint256[] internal _openSeriesIds;

    // ---------------------------------------------------------------- events
    event BoardCreated(uint256 indexed boardId, uint64 expiry, uint256[] seriesIds);
    event Bought(uint256 indexed seriesId, address indexed trader, uint256 size, uint256 premiumAssets, uint256 feeAssets, uint256 sigmaBuy, uint256 spotWad);
    event Closed(uint256 indexed seriesId, address indexed trader, uint256 size, uint256 proceedsAssets, uint256 sigmaClose, uint256 spotWad);
    event Settled(uint256 indexed boardId, uint256 settlementPriceWad, uint256 escrowedAddedWad, uint256 reservedReleasedWad);
    event Claimed(uint256 indexed seriesId, address indexed holder, uint256 amount, uint256 payoutAssets);
    event TradingPaused(bool paused);
    event ConfigUpdated(Config cfg);
    event TreasuryUpdated(address treasury);

    // ---------------------------------------------------------------- errors
    error TradingIsPaused();
    error OracleStale();
    error SeriesUnknown();
    error SeriesSettled();
    error SeriesExpired();
    error SizeTooSmall();
    error SlippageExceeded();
    error UtilizationExceeded();
    error VegaCapExceeded();
    error BadExpiry();
    error BadStrike();
    error TooManySeries();
    error BoardNotExpired();
    error BoardAlreadySettled();
    error SettlementNotReady();
    error NotSettled();
    error ConfigOutOfBounds(uint8 which);
    error MathUnavailable();
    error BoardUnknown();
    error ZeroAddress();

    // ---------------------------------------------------------------- constructor
    /// @param token_ EquinoxOptionToken yang akan di-`bindPool` ke pool ini oleh factory; vol_ = EquinoxVolEngine.
    constructor(Deploy memory d, address token_, address vol_)
        ERC20(d.name, d.symbol)
        ERC4626(IERC20(d.usdg))
        Ownable(d.owner)
    {
        math = IBlackScholes(d.math);
        feed = IAggregatorV3(d.feed);
        sequencerFeed = IAggregatorV3(d.sequencerFeed);
        priceScale = 10 ** (18 - IAggregatorV3(d.feed).decimals());
        assetScale = 10 ** (18 - IERC20Metadata(d.usdg).decimals());
        rWad = d.rWad;
        _setConfig(d.cfg);
        if (d.treasury == address(0)) revert ZeroAddress();
        treasury = d.treasury;
        token = EquinoxOptionToken(token_);
        vol = EquinoxVolEngine(vol_);
    }

    // ================================================================ LP (ERC-4626)

    /// @notice NAV = cash − escrow − nilai wajar opsi terbuka (mark-to-market lewat satu panggilan `markPortfolio`
    ///         pada σ_mark(0) — bukan σ_mark(util) — sehingga NAV tidak bisa dimanipulasi lewat cash/netVega yang
    ///         berubah pada deposit/redeem di blok yang sama (C-1). Kuotasi trading (`quoteBuy`/`quoteClose`) tetap
    ///         memakai dampak inventaris seperti semula.
    ///         Saat oracle stale atau `vol`/`math` gagal: NAV konservatif = cash − escrow − reserved (FR-36).
    function totalAssets() public view override returns (uint256) {
        uint256 cash = IERC20(asset()).balanceOf(address(this)) * assetScale;
        uint256 base = cash > escrowedPayouts ? cash - escrowedPayouts : 0;
        (uint256 liability, ) = _liabilityWad();
        uint256 nav = base > liability ? base - liability : 0;
        return nav / assetScale;
    }

    /// @dev Menolak deposit/mint saat `vol`/`math` sedang gagal — mencegah mint pada NAV konservatif lalu redeem
    ///      pada NAV MtM begitu math pulih (I-1b). Withdraw/redeem tetap berjalan di atas NAV konservatif.
    ///      Me-refresh referensi kapital (R2-a) & poke vol engine (R2-b) sebelum apa pun lain; deposit/mint pertama
    ///      langsung membootstrap referensi kapital agar LP pertama dihitung seketika, bukan setelah lag.
    function deposit(uint256 assets, address receiver) public override returns (uint256) {
        _refreshCapitalRef();
        _pokeVol();
        _requireFresh();
        (, bool conservative) = _liabilityWad();
        if (conservative) revert MathUnavailable();
        uint256 shares = super.deposit(assets, receiver);
        _bootstrapCapitalRef();
        return shares;
    }

    function mint(uint256 shares, address receiver) public override returns (uint256) {
        _refreshCapitalRef();
        _pokeVol();
        _requireFresh();
        (, bool conservative) = _liabilityWad();
        if (conservative) revert MathUnavailable();
        uint256 assets = super.mint(shares, receiver);
        _bootstrapCapitalRef();
        return assets;
    }

    /// @dev Refresh referensi kapital (R2-a) & poke vol engine (R2-b) sebelum delegasi; withdraw/redeem tidak
    ///      pernah dijeda dan tidak pernah butuh `math`/`vol` sukses (NAV konservatif tetap dipakai bila gagal).
    function withdraw(uint256 assets, address receiver, address owner_) public override returns (uint256) {
        _refreshCapitalRef();
        _pokeVol();
        return super.withdraw(assets, receiver, owner_);
    }

    function redeem(uint256 shares, address receiver, address owner_) public override returns (uint256) {
        _refreshCapitalRef();
        _pokeVol();
        return super.redeem(shares, receiver, owner_);
    }

    /// @notice Penarikan dibatasi likuiditas bebas: cash − escrow − reserved (FR-32). Tetap jalan saat stale (NAV konservatif).
    function maxWithdraw(address owner_) public view override returns (uint256) {
        return Math.min(super.maxWithdraw(owner_), freeLiquidity());
    }

    function maxRedeem(address owner_) public view override returns (uint256) {
        uint256 shares = super.maxRedeem(owner_);
        if (escrowedPayouts + reserved == 0) return shares; // tidak ada yang terkunci: hindari kehilangan 1 share oleh pembulatan
        return Math.min(shares, _convertToShares(freeLiquidity(), Math.Rounding.Floor));
    }

    /// @notice Likuiditas bebas dalam unit aset.
    function freeLiquidity() public view returns (uint256) {
        uint256 cash = IERC20(asset()).balanceOf(address(this)) * assetScale;
        uint256 locked = escrowedPayouts + reserved;
        return cash > locked ? (cash - locked) / assetScale : 0;
    }

    // ================================================================ listing

    /// @notice Board = satu expiry (Jumat 08:00 UTC, tenor ≤ tenorMax) dengan call+put per strike (FR-19).
    ///         Strike harus USDG bulat (kelipatan 1e18) — strike pecahan membuat reserve/release saat settle
    ///         tidak presisi dan bisa underflow (I-2).
    function createBoard(uint64 expiry, uint128[] calldata strikes) external onlyOwner returns (uint256 boardId) {
        if (tradingPaused) revert TradingIsPaused();
        if (expiry <= block.timestamp || expiry - block.timestamp > cfg.tenorMax) revert BadExpiry();
        if ((uint256(expiry) - FRIDAY_0800) % WEEK != 0) revert BadExpiry();
        uint256 s = _requireFresh();
        uint256 n = strikes.length;
        if (n == 0 || _openSeriesIds.length + 2 * n > cfg.maxOpenSeries) revert TooManySeries();
        boardId = _boards.length;
        _boards.push();
        Board storage b = _boards[boardId];
        b.expiry = expiry;
        uint128 prev = 0;
        for (uint256 i = 0; i < n; i++) {
            uint128 k = strikes[i];
            if (k % WAD != 0 || k <= prev || k < s / 2 || k > 2 * s) revert BadStrike();
            prev = k;
            for (uint256 c = 0; c < 2; c++) {
                bool isCall = c == 0;
                uint256 id = token.seriesId(address(this), expiry, k, isCall);
                if (series[id].expiry != 0) revert BadStrike();
                series[id] = Series({ boardId: uint32(boardId), expiry: expiry, strike: k, isCall: isCall, settled: false, oi: 0, vegaAcc: 0, payoutPerUnit: 0 });
                b.seriesIds.push(id);
                _openSeriesIds.push(id);
            }
        }
        emit BoardCreated(boardId, expiry, b.seriesIds);
    }

    // ================================================================ trading

    struct QuoteOut {
        uint256 premiumAssets;
        uint256 feeAssets;
        uint256 sigma;
        int256 delta;
        uint256 vegaTotal; // WAD per 1,00 vol untuk seluruh `size`
        uint256 spotWad;
    }

    /// @notice Kuotasi beli: σ_buy = σ_mark(util setelah trade) × (1 ± spread); premi ≥ floor (FR-13, FR-14, FR-23).
    /// @dev `q.vegaTotal` dihitung pada σ_buy (setelah dampak inventaris + spread), bukan σ_mark mid — sengaja
    ///      konservatif (lebih besar) untuk pembukuan `netVega`/vega cap di `buy`. Arah spread mengikuti tanda vega
    ///      unit pada σ₀ = σ_mark(0) (R3-a; sebelumnya σ_now = σ_mark(util) — lihat `quoteClose`): `+spread` bila
    ///      vega ≥ 0 (kasus normal), `−spread` bila negatif (capped call dekat S/2 pada σ tinggi — R2-c). Harga per
    ///      unit di-clamp `max(p_buy, p0)` — pool tidak pernah menjual di bawah mark σ₀ (R3-a); dikombinasikan
    ///      dengan clamp `min` di `quoteClose`, ini menjamin `quoteBuy ≥ p0 ≥ quoteClose` untuk tanda vega & rilis
    ///      berapa pun, sehingga NAV (yang di-mark pada σ₀, lihat `_liabilityWad`) tidak pernah turun akibat trade —
    ///      inilah yang menutup sandwich deposit/redeem residual yang C-1+R2-a sendiri belum tutup (lihat R3-a).
    function quoteBuy(uint256 seriesId, uint256 size) public view returns (QuoteOut memory q) {
        Series storage sr = _openSeries(seriesId);
        uint256 s = _requireFresh();
        uint256 t = _years(sr.expiry);
        uint256 sigma0 = vol.sigmaMark(0);
        (uint256 p0, , int256 vega0) = _price(s, sr.strike, t, sigma0, sr.isCall);
        uint256 vegaTotal = (vega0 > 0 ? uint256(vega0) : 0) * size / WAD;
        bool posVega = vega0 >= 0;
        uint256 spread = vol.spread();
        uint256 sigmaBuy = vol.sigmaMark(_util(netVega + vegaTotal)) * (posVega ? (WAD + spread) : (WAD - spread)) / WAD;
        (uint256 pBuy, int256 delta, int256 vegaBuySigned) = _price(s, sr.strike, t, sigmaBuy, sr.isCall);
        uint256 vegaBuy = vegaBuySigned > 0 ? uint256(vegaBuySigned) : 0;
        uint256 p = pBuy > p0 ? pBuy : p0; // R3-a: never sell below the mark
        uint256 premiumWad = p * size / WAD;
        uint256 floorWad = uint256(sr.strike) * size / WAD * cfg.minPremiumBps / 10_000;
        if (premiumWad < floorWad) premiumWad = floorWad;
        q.premiumAssets = _ceilAssets(premiumWad);
        q.feeAssets = _ceilAssets(premiumWad * cfg.feeBps / 10_000);
        q.sigma = sigmaBuy;
        q.delta = delta;
        q.vegaTotal = vegaBuy * size / WAD;
        q.spotWad = s;
    }

    /// @notice Kuotasi tutup: σ_close = σ_mark(util setelah tutup) × (1 ∓ spread); proceeds dibulatkan ke bawah.
    /// @dev Arah spread mengikuti tanda vega unit pada σ₀ = σ_mark(0) (R3-a; dihitung ulang di sini sama seperti
    ///      `quoteBuy`): `−spread` bila vega ≥ 0, `+spread` bila negatif. Harga per unit di-clamp `min(p_close, p0)`
    ///      — pool tidak pernah membeli balik di atas mark σ₀ (R3-a), menjamin `quoteBuy ≥ p0 ≥ quoteClose` untuk
    ///      tanda vega & rilis berapa pun (lihat NatSpec `quoteBuy`).
    function quoteClose(uint256 seriesId, uint256 size) public view returns (uint256 proceedsAssets, uint256 sigmaClose, uint256 spotWad) {
        Series storage sr = _openSeries(seriesId);
        uint256 s = _requireFresh();
        uint256 t = _years(sr.expiry);
        uint256 rel = _vegaRelease(sr, size);
        uint256 sigma0 = vol.sigmaMark(0);
        (uint256 p0, , int256 vega0) = _price(s, sr.strike, t, sigma0, sr.isCall);
        bool posVega = vega0 >= 0;
        uint256 spread = vol.spread();
        sigmaClose = vol.sigmaMark(_util(netVega - rel)) * (posVega ? (WAD - spread) : (WAD + spread)) / WAD;
        (uint256 pClose, , ) = _price(s, sr.strike, t, sigmaClose, sr.isCall);
        uint256 p = pClose < p0 ? pClose : p0; // R3-a: never buy back above the mark
        proceedsAssets = (p * size / WAD) / assetScale;
        spotWad = s;
    }

    /// @notice Beli `size` unit (WAD) seri; membayar premi + fee dalam aset; mencetak ERC-1155 (FR-21, FR-24, FR-25).
    /// @dev `maxPremiumAssets` adalah batas slippage atas premi + fee (total yang ditransfer dari trader); nilai
    ///      kembalian (`premiumAssets`) hanya premi, tanpa fee.
    function buy(uint256 seriesId, uint256 size, uint256 maxPremiumAssets) external nonReentrant returns (uint256 premiumAssets) {
        _refreshCapitalRef();
        _pokeVol();
        if (tradingPaused) revert TradingIsPaused();
        if (size < cfg.minSize) revert SizeTooSmall();
        Series storage sr = _openSeries(seriesId);
        QuoteOut memory q = quoteBuy(seriesId, size);
        if (q.premiumAssets + q.feeAssets > maxPremiumAssets) revert SlippageExceeded();
        uint256 capital = _capitalForCaps();
        uint256 addReserve = uint256(sr.strike) * size / WAD;
        if (reserved + addReserve > capital * cfg.maxUtilBps / 10_000) revert UtilizationExceeded();
        if (netVega + q.vegaTotal > capital * cfg.vegaCapBps / 10_000) revert VegaCapExceeded();
        reserved += addReserve;
        netVega += q.vegaTotal;
        sr.oi += size;
        sr.vegaAcc += q.vegaTotal;
        IERC20(asset()).safeTransferFrom(msg.sender, address(this), q.premiumAssets + q.feeAssets);
        if (q.feeAssets > 0) IERC20(asset()).safeTransfer(treasury, q.feeAssets);
        token.mint(msg.sender, seriesId, size);
        emit Bought(seriesId, msg.sender, size, q.premiumAssets, q.feeAssets, q.sigma, q.spotWad);
        return q.premiumAssets;
    }

    /// @notice Tutup `size` unit sebelum expiry; tidak pernah dijeda (FR-22, FR-33).
    function close(uint256 seriesId, uint256 size, uint256 minProceedsAssets) external nonReentrant returns (uint256 proceedsAssets) {
        _refreshCapitalRef();
        _pokeVol();
        Series storage sr = _openSeries(seriesId);
        if (size == 0 || size > sr.oi) revert SizeTooSmall();
        uint256 sigmaClose;
        uint256 s;
        (proceedsAssets, sigmaClose, s) = quoteClose(seriesId, size);
        if (proceedsAssets < minProceedsAssets) revert SlippageExceeded();
        uint256 rel = _vegaRelease(sr, size);
        sr.oi -= size;
        sr.vegaAcc -= rel;
        netVega -= rel;
        reserved -= uint256(sr.strike) * size / WAD;
        token.burn(msg.sender, seriesId, size);
        IERC20(asset()).safeTransfer(msg.sender, proceedsAssets);
        emit Closed(seriesId, msg.sender, size, proceedsAssets, sigmaClose, s);
    }

    // ================================================================ settlement

    /// @notice Permissionless setelah expiry; memakai round Chainlink dengan `updatedAt ≥ expiry` yang masih segar (FR-27..29).
    function settle(uint256 boardId) external nonReentrant {
        _refreshCapitalRef();
        _pokeVol();
        if (boardId >= _boards.length) revert BoardUnknown();
        Board storage b = _boards[boardId];
        if (b.settled) revert BoardAlreadySettled();
        if (block.timestamp < b.expiry) revert BoardNotExpired();
        OracleLib.Spot memory sp = _spot();
        if (!sp.fresh || sp.updatedAt < b.expiry) revert SettlementNotReady();
        uint256 sT = sp.priceWad;
        uint256 added;
        uint256 released;
        uint256 n = b.seriesIds.length;
        for (uint256 i = 0; i < n; i++) {
            uint256 id = b.seriesIds[i];
            Series storage sr = series[id];
            uint256 k = sr.strike;
            uint256 payout = _payoutPerUnit(sT, k, sr.isCall);
            sr.settled = true;
            sr.payoutPerUnit = payout;
            added += sr.oi * payout / WAD;
            released += sr.oi * k / WAD;
            netVega -= Math.min(netVega, sr.vegaAcc);
            sr.vegaAcc = 0;
            _removeOpen(id);
        }
        escrowedPayouts += added;
        reserved -= released;
        b.settled = true;
        b.settlementPrice = sT;
        emit Settled(boardId, sT, added, released);
        uint256 bounty = cfg.settleBounty;
        if (bounty > 0 && freeLiquidity() >= bounty) IERC20(asset()).safeTransfer(msg.sender, bounty);
    }

    /// @notice Klaim payout seri yang sudah settle; membakar token; tidak pernah bisa dijeda (FR-30).
    function claim(uint256 seriesId, uint256 amount) external nonReentrant returns (uint256 payoutAssets) {
        Series storage sr = series[seriesId];
        if (sr.expiry == 0) revert SeriesUnknown();
        if (!sr.settled) revert NotSettled();
        sr.oi -= amount; // INV-4: totalSupply(id) == oi juga setelah settle
        uint256 payoutWad = amount * sr.payoutPerUnit / WAD;
        escrowedPayouts -= payoutWad;
        payoutAssets = payoutWad / assetScale;
        token.burn(msg.sender, seriesId, amount);
        if (payoutAssets > 0) IERC20(asset()).safeTransfer(msg.sender, payoutAssets);
        emit Claimed(seriesId, msg.sender, amount, payoutAssets);
    }

    // ================================================================ admin

    /// @notice Hanya `buy` dan `createBoard` yang dijeda; `close`, `claim`, `withdraw`, `settle` tidak pernah (FR-33).
    function pauseTrading(bool paused) external onlyOwner {
        tradingPaused = paused;
        emit TradingPaused(paused);
    }

    function setConfig(Config calldata c) external onlyOwner {
        _setConfig(c);
    }

    function setTreasury(address t) external onlyOwner {
        if (t == address(0)) revert ZeroAddress();
        treasury = t;
        emit TreasuryUpdated(t);
    }

    // ================================================================ views

    function boardCount() external view returns (uint256) {
        return _boards.length;
    }

    function board(uint256 boardId) external view returns (uint64 expiry, bool settled, uint256 settlementPrice, uint256[] memory seriesIds) {
        if (boardId >= _boards.length) revert BoardUnknown();
        Board storage b = _boards[boardId];
        return (b.expiry, b.settled, b.settlementPrice, b.seriesIds);
    }

    function openSeriesIds() external view returns (uint256[] memory) {
        return _openSeriesIds;
    }

    /// @notice (spot WAD, segar?) — untuk UI/demo.
    function spot() external view returns (uint256 priceWad, bool fresh) {
        OracleLib.Spot memory sp = _spot();
        return (sp.priceWad, sp.fresh);
    }

    /// @notice σ_mark saat ini (mid, tanpa spread).
    function sigmaMarkNow() external view returns (uint256) {
        return vol.sigmaMark(_util(netVega));
    }

    // ================================================================ internal

    function _setConfig(Config memory c) internal {
        if (c.feeBps > 1000) revert ConfigOutOfBounds(0);
        if (c.maxUtilBps == 0 || c.maxUtilBps > 9000) revert ConfigOutOfBounds(1);
        if (c.vegaCapBps == 0 || c.vegaCapBps > 5000) revert ConfigOutOfBounds(2);
        if (c.minPremiumBps > 100) revert ConfigOutOfBounds(3);
        if (c.heartbeat == 0 || c.heartbeat > 1 days) revert ConfigOutOfBounds(4);
        if (c.staleMult == 0) revert ConfigOutOfBounds(5);
        if (c.maxOpenSeries == 0 || c.maxOpenSeries > 32) revert ConfigOutOfBounds(6);
        if (c.tenorMax == 0 || c.tenorMax > 90 days) revert ConfigOutOfBounds(7);
        if (c.minSize == 0) revert ConfigOutOfBounds(8);
        if (c.sequencerGrace > 1 days) revert ConfigOutOfBounds(9);
        if (c.settleBounty > 100 * (WAD / assetScale)) revert ConfigOutOfBounds(10);
        cfg = c;
        emit ConfigUpdated(c);
    }

    function _spot() internal view returns (OracleLib.Spot memory) {
        return OracleLib.read(feed, sequencerFeed, priceScale, cfg.heartbeat, cfg.staleMult, cfg.sequencerGrace);
    }

    function _requireFresh() internal view returns (uint256 priceWad) {
        OracleLib.Spot memory sp = _spot();
        if (!sp.fresh) revert OracleStale();
        return sp.priceWad;
    }

    function _openSeries(uint256 id) internal view returns (Series storage sr) {
        sr = series[id];
        if (sr.expiry == 0) revert SeriesUnknown();
        if (sr.settled) revert SeriesSettled();
        if (sr.expiry <= block.timestamp + T_MIN) revert SeriesExpired();
    }

    /// @dev T dalam tahun WAD; dijamin ≥ T_MIN oleh _openSeries.
    function _years(uint64 expiry) internal view returns (uint256) {
        return (uint256(expiry) - block.timestamp) * WAD / SECONDS_PER_YEAR;
    }

    /// @dev cash − escrow (WAD) — basis utilisasi & vega cap; sengaja tanpa MtM agar tidak rekursif.
    function _capitalWad() internal view returns (uint256) {
        uint256 cash = IERC20(asset()).balanceOf(address(this)) * assetScale;
        return cash > escrowedPayouts ? cash - escrowedPayouts : 0;
    }

    /// @dev util_vega = clamp(netVega / vegaCap, 0, 1); pool kosong → 1 (harga maksimal, dan buy tetap ditolak oleh cap).
    ///      Memakai `_capitalForCaps()` (kapital yang di-lag, R2-a), bukan kapital live.
    function _util(uint256 vega) internal view returns (uint256) {
        uint256 cap = _capitalForCaps() * cfg.vegaCapBps / 10_000;
        if (cap == 0) return WAD;
        uint256 u = vega * WAD / cap;
        return u > WAD ? WAD : u;
    }

    /// @dev Harga & Greeks satu unit: call = spread ter-cap C(K) − C(2K); put = BS biasa. Vega dikembalikan
    ///      bertanda (bisa negatif untuk capped call dekat S/2 pada σ tinggi, R2-c) — pemanggil yang memutuskan
    ///      klem ke 0 untuk pembukuan vs. memakai tandanya untuk arah spread.
    function _price(uint256 s, uint256 k, uint256 t, uint256 sigma, bool isCall) internal view returns (uint256 p, int256 delta, int256 vega) {
        if (isCall) {
            (p, delta, vega) = math.cappedCall(s, k, k * CAP_MULT / WAD, t, sigma, rWad);
        } else {
            uint256 vegaU;
            (p, delta, , vegaU, ) = math.quote(s, k, t, sigma, rWad, false);
            vega = int256(vegaU);
        }
    }

    /// @dev Referensi kapital yang dipakai util/cap: `min(live, capitalRefPrev)` (R2-a). Sisi `live` membuat
    ///      penarikan langsung mengurangi kapasitas trading; sisi `capitalRefPrev` membuat deposit baru hanya
    ///      menambah kapasitas setelah ia sempat "diam" selama ≥ CAPITAL_REF_DELAY.
    function _capitalForCaps() internal view returns (uint256) {
        uint256 live = _capitalWad();
        return live < capitalRefPrev ? live : capitalRefPrev;
    }

    /// @dev Menggeser jendela referensi kapital sekali per ≥ CAPITAL_REF_DELAY; dipanggil sebagai baris pertama
    ///      `buy`/`close`/`settle`/`deposit`/`mint`/`withdraw`/`redeem` (R2-a).
    function _refreshCapitalRef() internal {
        if (capitalRefAt != 0 && block.timestamp - capitalRefAt >= CAPITAL_REF_DELAY) {
            capitalRefPrev = capitalRefCur;
            capitalRefCur = _capitalWad();
            capitalRefAt = uint64(block.timestamp);
        }
    }

    /// @dev Menetapkan referensi kapital pertama kali (LP pertama dihitung seketika, bukan setelah lag); dipanggil
    ///      setelah `super.deposit`/`super.mint` agar kapital yang di-snapshot sudah termasuk dana yang baru masuk.
    function _bootstrapCapitalRef() internal {
        if (capitalRefAt == 0) {
            uint256 c = _capitalWad();
            capitalRefPrev = c;
            capitalRefCur = c;
            capitalRefAt = uint64(block.timestamp);
        }
    }

    /// @dev Poke observasi vol engine (R2-b), best-effort: `EquinoxVolEngine.sigmaBase()`/`poke()` menyentuh `math`
    ///      bahkan di jalur "tidak ada round baru", jadi dibungkus try/catch — kegagalan di sini tidak boleh
    ///      memblokir `withdraw`/`redeem`/`close`/`claim`, atau membocorkan revert mentah `math` alih-alih
    ///      `MathUnavailable` yang sudah ditangani `_liabilityWad` (I-1).
    function _pokeVol() internal {
        try vol.poke() {} catch {}
    }

    /// @dev Pelepasan vega proporsional terhadap OI yang ditutup.
    function _vegaRelease(Series storage sr, uint256 size) internal view returns (uint256) {
        if (sr.oi == 0) return 0;
        uint256 rel = sr.vegaAcc * size / sr.oi;
        return Math.min(rel, netVega);
    }

    /// @dev Kewajiban (WAD): MtM via satu panggilan markPortfolio pada σ_mark(0) (σ_base × VRP, TANPA dampak
    ///      inventaris/util — util bergantung pada `cash`/`netVega`, yang berubah tepat oleh deposit/redeem itu
    ///      sendiri, sehingga memakainya di sini membuka manipulasi NAV, lihat C-1). Seri dalam blackout pra-expiry
    ///      atau yang sudah lewat expiry (`expiry <= now + T_MIN`, predikat yang sama dengan `_openSeries`) TIDAK
    ///      diberi nilai waktu: mereka di-mark pada nilai intrinsik terhadap spot saat ini (`_payoutPerUnit`, rumus
    ///      yang sama dengan `settle`) dan dilewatkan oleh markPortfolio lewat `oi[i] = 0`. Dengan begitu `settle`
    ///      hanya menggeser NAV sebesar bounty dan selisih antara spot mark dan round settlement — tidak ada lompatan
    ///      NAV yang bisa ditangkap deposit→settle→redeem (I-1 review akhir). `conservative = true` berarti nilai
    ///      kembalian adalah `reserved` (oracle stale, atau `vol`/`math` gagal — FR-36); dipakai `deposit`/`mint`
    ///      untuk menolak mint pada NAV konservatif (I-1).
    function _liabilityWad() internal view returns (uint256 liability, bool conservative) {
        uint256 n = _openSeriesIds.length;
        if (n == 0) return (0, false);
        OracleLib.Spot memory sp = _spot();
        if (!sp.fresh) return (reserved, true);
        uint256[] memory k = new uint256[](n);
        uint256[] memory t = new uint256[](n);
        bool[] memory isCall = new bool[](n);
        uint256[] memory oi = new uint256[](n);
        uint256 intrinsic;
        for (uint256 i = 0; i < n; i++) {
            Series storage sr = series[_openSeriesIds[i]];
            k[i] = sr.strike;
            isCall[i] = sr.isCall;
            if (sr.expiry <= block.timestamp + T_MIN) {
                intrinsic += sr.oi * _payoutPerUnit(sp.priceWad, sr.strike, sr.isCall) / WAD; // oi[i] tetap 0
            } else {
                t[i] = (sr.expiry - block.timestamp) * WAD / SECONDS_PER_YEAR;
                oi[i] = sr.oi;
            }
        }
        uint256 sigma;
        try vol.sigmaMark(0) returns (uint256 s) {
            sigma = s;
        } catch {
            return (reserved, true);
        }
        try math.markPortfolio(sp.priceWad, rWad, sigma, CAP_MULT, k, t, isCall, oi) returns (uint256 mid, int256) {
            return (mid + intrinsic, false);
        } catch {
            return (reserved, true);
        }
    }

    /// @dev Payout per unit (WAD) pada harga `s`: call = min(max(S − K, 0), K) (cap 2K), put = max(K − S, 0).
    ///      Satu-satunya rumus payout — dipakai `settle` (harga settlement) dan `_liabilityWad` (spot saat ini untuk
    ///      seri blackout/expired) agar keduanya tidak bisa menyimpang.
    function _payoutPerUnit(uint256 s, uint256 k, bool isCall) internal pure returns (uint256) {
        if (isCall) {
            uint256 p = s > k ? s - k : 0;
            return p > k ? k : p;
        }
        return k > s ? k - s : 0;
    }

    function _removeOpen(uint256 id) internal {
        uint256 n = _openSeriesIds.length;
        for (uint256 i = 0; i < n; i++) {
            if (_openSeriesIds[i] == id) {
                _openSeriesIds[i] = _openSeriesIds[n - 1];
                _openSeriesIds.pop();
                return;
            }
        }
    }

    function _ceilAssets(uint256 wad) internal view returns (uint256) {
        return (wad + assetScale - 1) / assetScale;
    }
}
