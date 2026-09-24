<?php
/**
 * Premier Corporate Finance - website admin API.
 * Saves deals as files on this server. No database needed.
 * Needs PHP 7.4 or newer (standard on cPanel hosting).
 */
declare(strict_types=1);

// Unicode-safe length and cut, without needing the mbstring extension.
function ulen(string $s): int { return function_exists('mb_strlen') ? mb_strlen($s, 'UTF-8') : (int) preg_match_all('/./us', $s); }
function ucut(string $s, int $max): string {
  if (function_exists('mb_substr')) return mb_substr($s, 0, $max, 'UTF-8');
  preg_match('/^.{0,' . $max . '}/us', $s, $m); return $m[0] ?? '';
}

const DATA_DIR    = __DIR__ . '/data';                 // private (blocked by .htaccess and PHP guards)
const AUTH_FILE   = DATA_DIR . '/auth.php';
const ALL_FILE    = DATA_DIR . '/deals-all.php';
const TRIES_FILE  = DATA_DIR . '/attempts.php';
const BACKUP_DIR  = DATA_DIR . '/backups';
const PUBLIC_FILE = __DIR__ . '/../data/deals.json';   // public list the website reads
const GUARD       = "<?php exit; ?>\n";
const TYPES       = ['sale', 'acquisition', 'mbo', 'fundraise'];
const SECTORS     = ['tic', 'ndt', 'env', 'construction', 'fm', 'life', 'mfg', 'other'];
const MAX_FAILS   = 5;
const LOCK_SECS   = 900;
const KEEP_BACKUPS = 30;

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');

$https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
session_name('premier_admin');
session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'secure' => $https, 'httponly' => true, 'samesite' => 'Strict']);
session_start();

function out(array $data, int $code = 200): void {
  http_response_code($code);
  echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}
function fail(string $msg, int $code = 400): void { out(['ok' => false, 'error' => $msg], $code); }

function read_guarded(string $file) {
  if (!is_file($file)) return null;
  $s = (string) file_get_contents($file);
  if (strpos($s, GUARD) === 0) $s = substr($s, strlen(GUARD));
  return json_decode($s, true);
}
function write_atomic(string $file, string $content): bool {
  $dir = dirname($file);
  if (!is_dir($dir) && !mkdir($dir, 0750, true)) return false;
  $tmp = $file . '.tmp-' . bin2hex(random_bytes(4));
  if (file_put_contents($tmp, $content, LOCK_EX) === false) return false;
  return rename($tmp, $file);
}
function write_guarded(string $file, $data): bool {
  return write_atomic($file, GUARD . json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT));
}
function body(): array {
  $raw = (string) file_get_contents('php://input');
  if (strlen($raw) > 20000) fail('Request too large.', 413);
  $j = json_decode($raw, true);
  return is_array($j) ? $j : [];
}
function signed_in(): bool { return !empty($_SESSION['admin']); }
function require_admin(): void {
  if (!signed_in()) fail('Please sign in again.', 401);
  $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
  if (!is_string($token) || empty($_SESSION['csrf']) || !hash_equals($_SESSION['csrf'], $token)) fail('Please reload the page and try again.', 403);
}
function same_origin(): void {
  $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
  if ($origin === '') return;
  $host = parse_url($origin, PHP_URL_HOST);
  if ($host !== ($_SERVER['HTTP_HOST'] ?? '') && $host . ':' . parse_url($origin, PHP_URL_PORT) !== ($_SERVER['HTTP_HOST'] ?? '')) fail('Not allowed.', 403);
}

/* ---------- Deals ---------- */
function load_all(): array {
  $all = read_guarded(ALL_FILE);
  if (is_array($all)) return $all;
  // First run: start from the public list that shipped with the website.
  $pub = is_file(PUBLIC_FILE) ? json_decode((string) file_get_contents(PUBLIC_FILE), true) : [];
  $all = [];
  foreach ((is_array($pub) ? $pub : []) as $d) {
    $all[] = [
      'id' => bin2hex(random_bytes(8)), 'no' => (int) $d['no'], 'business' => (string) $d['business'],
      'counterparty' => $d['counterparty'] ?? null, 'type' => (string) $d['type'], 'sector' => (string) $d['sector'],
      'year' => isset($d['year']) ? (int) $d['year'] : null, 'published' => true,
    ];
  }
  return $all;
}
function save_all(array $all): void {
  usort($all, function ($a, $b) { return $b['no'] <=> $a['no']; });
  if (is_file(ALL_FILE)) {
    if (!is_dir(BACKUP_DIR)) mkdir(BACKUP_DIR, 0750, true);
    copy(ALL_FILE, BACKUP_DIR . '/deals-' . gmdate('Ymd-His') . '-' . bin2hex(random_bytes(2)) . '.php');
    $old = glob(BACKUP_DIR . '/deals-*.php') ?: [];
    sort($old);
    foreach (array_slice($old, 0, max(0, count($old) - KEEP_BACKUPS)) as $f) @unlink($f);
  }
  if (!write_guarded(ALL_FILE, array_values($all))) fail('The change could not be saved. Check the folder permissions on the server.', 500);
  $public = [];
  foreach ($all as $d) {
    if (empty($d['published'])) continue;
    $public[] = ['no' => $d['no'], 'business' => $d['business'], 'counterparty' => $d['counterparty'],
                 'type' => $d['type'], 'sector' => $d['sector'], 'year' => $d['year']];
  }
  if (!write_atomic(PUBLIC_FILE, json_encode($public, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES))) fail('The website list could not be updated. Check the folder permissions on the server.', 500);
}
function clean_deal(array $in): array {
  $str = function ($v, int $max) { $v = trim(preg_replace('/\s+/u', ' ', (string) $v)); return ucut($v, $max); };
  $d = [
    'id' => isset($in['id']) && preg_match('/^[a-f0-9]{16}$/', (string) $in['id']) ? (string) $in['id'] : null,
    'no' => (int) ($in['no'] ?? 0),
    'business' => $str($in['business'] ?? '', 120),
    'counterparty' => ($in['counterparty'] ?? null) === null ? null : $str($in['counterparty'], 120),
    'type' => (string) ($in['type'] ?? ''),
    'sector' => (string) ($in['sector'] ?? ''),
    'year' => ($in['year'] ?? null) === null || $in['year'] === '' ? null : (int) $in['year'],
    'published' => !empty($in['published']),
  ];
  if ($d['counterparty'] === '' || $d['type'] === 'mbo') $d['counterparty'] = null;
  if ($d['business'] === '') fail('Enter the business name.');
  if (!in_array($d['type'], TYPES, true)) fail('Choose a deal type.');
  if (!in_array($d['sector'], SECTORS, true)) fail('Choose a sector.');
  if ($d['no'] < 1 || $d['no'] > 9999) fail('Enter a deal number between 1 and 9999.');
  if ($d['year'] !== null && ($d['year'] < 1980 || $d['year'] > 2100)) fail('Enter a 4-digit year, for example 2026.');
  if (in_array($d['type'], ['acquisition', 'fundraise'], true) && $d['counterparty'] === null) fail('Enter the other company.');
  return $d;
}

/* ---------- Login protection ---------- */
function client_key(): string { return hash('sha256', ($_SERVER['REMOTE_ADDR'] ?? '') . '|premier'); }
function tries(): array { $t = read_guarded(TRIES_FILE); return is_array($t) ? $t : []; }
function locked(): int {
  $t = tries()[client_key()] ?? null;
  if (!$t || $t['n'] < MAX_FAILS) return 0;
  $left = $t['t'] + LOCK_SECS - time();
  return $left > 0 ? $left : 0;
}
function record_fail(): void {
  $all = tries(); $k = client_key(); $now = time();
  foreach ($all as $key => $v) if ($v['t'] + LOCK_SECS < $now) unset($all[$key]);
  $n = ($all[$k]['n'] ?? 0) + 1;
  $all[$k] = ['n' => $n, 't' => $now];
  write_guarded(TRIES_FILE, $all);
}
function clear_fails(): void { $all = tries(); unset($all[client_key()]); write_guarded(TRIES_FILE, $all); }

/* ---------- Routes ---------- */
$action = (string) ($_GET['action'] ?? '');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'POST') same_origin();
$auth = read_guarded(AUTH_FILE);
$has_password = is_array($auth) && !empty($auth['hash']);

if ($action === 'session' && $method === 'GET') {
  out(['ok' => true, 'setup' => $has_password, 'signedIn' => signed_in(), 'csrf' => signed_in() ? $_SESSION['csrf'] : null]);
}

if ($action === 'login' && $method === 'POST') {
  if (!$has_password) fail('The admin password has not been set yet.', 409);
  if ($wait = locked()) fail('Too many attempts. Try again in ' . (int) ceil($wait / 60) . ' minutes.', 429);
  $pw = (string) (body()['password'] ?? '');
  if (!password_verify($pw, $auth['hash'])) { record_fail(); usleep(400000); fail('The password is not correct.', 401); }
  clear_fails();
  session_regenerate_id(true);
  $_SESSION['admin'] = true;
  $_SESSION['csrf'] = bin2hex(random_bytes(32));
  out(['ok' => true, 'csrf' => $_SESSION['csrf']]);
}

if ($action === 'logout' && $method === 'POST') {
  $_SESSION = [];
  session_destroy();
  out(['ok' => true]);
}

if ($action === 'list' && $method === 'GET') {
  if (!signed_in()) fail('Please sign in again.', 401);
  $all = load_all();
  usort($all, function ($a, $b) { return $b['no'] <=> $a['no']; });
  out(['ok' => true, 'deals' => $all]);
}

if ($action === 'save' && $method === 'POST') {
  require_admin();
  $d = clean_deal(body()['deal'] ?? []);
  $fp = fopen(DATA_DIR . '/.lock', 'c'); flock($fp, LOCK_EX);
  $all = load_all();
  foreach ($all as $x) if ($x['no'] === $d['no'] && $x['id'] !== $d['id']) fail('That deal number is already used. Choose another number.', 409);
  if ($d['id']) {
    $found = false;
    foreach ($all as $i => $x) if ($x['id'] === $d['id']) { $all[$i] = $d; $found = true; }
    if (!$found) fail('That deal no longer exists. Reload the page.', 404);
  } else {
    $d['id'] = bin2hex(random_bytes(8));
    $all[] = $d;
  }
  save_all($all);
  flock($fp, LOCK_UN);
  out(['ok' => true, 'deal' => $d]);
}

if ($action === 'delete' && $method === 'POST') {
  require_admin();
  $id = (string) (body()['id'] ?? '');
  $fp = fopen(DATA_DIR . '/.lock', 'c'); flock($fp, LOCK_EX);
  $all = load_all();
  $left = array_values(array_filter($all, function ($x) use ($id) { return $x['id'] !== $id; }));
  if (count($left) === count($all)) fail('That deal no longer exists. Reload the page.', 404);
  save_all($left);
  flock($fp, LOCK_UN);
  out(['ok' => true]);
}

if ($action === 'password' && $method === 'POST') {
  require_admin();
  $b = body();
  if (!password_verify((string) ($b['current'] ?? ''), $auth['hash'])) fail('Your current password is not correct.', 401);
  $new = (string) ($b['new'] ?? '');
  if (ulen($new) < 10) fail('Use at least 10 characters.');
  if (!write_guarded(AUTH_FILE, ['hash' => password_hash($new, PASSWORD_DEFAULT), 'changed' => gmdate('c')])) fail('The password could not be saved.', 500);
  out(['ok' => true]);
}

fail('Unknown request.', 404);
