<?php
/**
 * Premier website admin - set the admin password.
 * Works only while no password exists. To reset a forgotten password,
 * delete admin/data/auth.php on the server, then open this page again.
 */
declare(strict_types=1);

// Unicode-safe length and cut, without needing the mbstring extension.
function ulen(string $s): int { return function_exists('mb_strlen') ? mb_strlen($s, 'UTF-8') : (int) preg_match_all('/./us', $s); }
function ucut(string $s, int $max): string {
  if (function_exists('mb_substr')) return mb_substr($s, 0, $max, 'UTF-8');
  preg_match('/^.{0,' . $max . '}/us', $s, $m); return $m[0] ?? '';
}
const SETUP_CODE = 'C2F636-B196F3-3FBA78'; // Needed to set the password. Keep it private.
const AUTH_FILE = __DIR__ . '/data/auth.php';
const GUARD = "<?php exit; ?>\n";
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');
$exists = is_file(AUTH_FILE);
$msg = ''; $ok = false;
if (!$exists && ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
  $code = trim((string) ($_POST['code'] ?? ''));
  $pw = (string) ($_POST['password'] ?? '');
  $pw2 = (string) ($_POST['confirm'] ?? '');
  if (SETUP_CODE === '' || !hash_equals(SETUP_CODE, strtoupper($code))) { usleep(500000); $msg = 'The setup code is not correct.'; }
  elseif (ulen($pw) < 10) $msg = 'Use at least 10 characters.';
  elseif ($pw !== $pw2) $msg = 'The 2 passwords do not match.';
  else {
    if (!is_dir(__DIR__ . '/data')) mkdir(__DIR__ . '/data', 0750, true);
    $ok = file_put_contents(AUTH_FILE, GUARD . json_encode(['hash' => password_hash($pw, PASSWORD_DEFAULT), 'changed' => gmdate('c')]), LOCK_EX) !== false;
    $msg = $ok ? '' : 'The password could not be saved. Check that the admin/data folder can be written to.';
    $exists = $ok;
  }
}
$e = function ($s) { return htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8'); };
?><!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Set the admin password | Premier</title>
<style>
body{margin:0;font:400 17px/1.6 "IBM Plex Sans",Arial,sans-serif;background:#F6F7F9;color:#15202F}
header{background:#0E2140;color:#fff;padding:18px 24px;font:500 20px Georgia,serif;letter-spacing:.2em}
main{max-width:30rem;margin:48px auto;padding:0 20px}
h1{font:500 34px/1.1 Georgia,serif;margin:0 0 12px}
label{display:block;font-weight:500;margin:18px 0 6px}
input{width:100%;box-sizing:border-box;font:inherit;padding:12px;border:1px solid #8793A3;border-radius:4px;min-height:48px}
input:focus-visible{outline:3px solid #2F63AE;outline-offset:1px}
button,a.btn{display:inline-block;margin-top:24px;background:#0E2140;color:#fff;border:0;border-radius:999px;padding:13px 24px;font:500 16px inherit;cursor:pointer;text-decoration:none}
.msg{margin-top:16px;color:#B3261E;font-weight:500}.ok{color:#1E6B3A}
</style></head><body><header>PREMIER</header><main>
<?php if ($exists && $ok): ?>
  <h1>Password saved</h1><p class="ok">The admin password is set. You can now sign in.</p>
  <a class="btn" href="./">Go to the admin page</a>
<?php elseif ($exists): ?>
  <h1>Password already set</h1>
  <p>This page only works when no password exists. To reset a forgotten password, delete the file <strong>admin/data/auth.php</strong> on the server using cPanel File Manager, then open this page again.</p>
  <a class="btn" href="./">Go to the admin page</a>
<?php else: ?>
  <h1>Set the admin password</h1>
  <p>Choose the password the client will use to sign in to the admin page.</p>
  <form method="post" autocomplete="off">
    <label for="code">Setup code</label>
    <input id="code" name="code" required autocomplete="off">
    <label for="pw">New password (at least 10 characters)</label>
    <input id="pw" name="password" type="password" minlength="10" required autocomplete="new-password">
    <label for="pw2">Type the password again</label>
    <input id="pw2" name="confirm" type="password" minlength="10" required autocomplete="new-password">
    <?php if ($msg): ?><p class="msg" role="alert"><?= $e($msg) ?></p><?php endif; ?>
    <button type="submit">Save password</button>
  </form>
<?php endif; ?>
</main></body></html>
