# Run this on YOUR PC. It never prints a token and never sends one anywhere
# except to graph.facebook.com. Read it before running.
#
# What it does: turns the short-lived token from Graph API Explorer into the
# numeric Page ID and the Page access token the workflows need, and puts the
# Page token on your clipboard so you can paste it straight into the GitHub
# secret FB_PAGE_TOKEN without ever seeing it.
$ErrorActionPreference = 'Stop'
$G = 'https://graph.facebook.com/v21.0'

function Read-Secret($label) {
    $s = Read-Host $label -AsSecureString
    [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
}

$appId = Read-Host 'App ID (Meta app -> Settings -> Basic)'
$appSecret = Read-Secret 'App Secret (hidden)'
$short = Read-Secret 'Access token from Graph API Explorer (hidden)'

# 1. long-lived user token
$q = "grant_type=fb_exchange_token&client_id=$appId&client_secret=$appSecret&fb_exchange_token=$short"
$long = (Invoke-RestMethod "$G/oauth/access_token?$q").access_token
Remove-Variable appSecret, short

# 2. did the token get the permission that posting needs?
$granted = (Invoke-RestMethod "$G/me/permissions?access_token=$long").data |
    Where-Object { $_.status -eq 'granted' } | ForEach-Object { $_.permission }
foreach ($need in 'pages_show_list', 'pages_read_engagement', 'pages_manage_posts') {
    if ($granted -contains $need) { Write-Host "  OK       $need" -ForegroundColor Green }
    else { Write-Host "  MISSING  $need  (add it in Graph API Explorer, generate the token again)" -ForegroundColor Red }
}
if ($granted -notcontains 'pages_manage_posts') { throw 'pages_manage_posts is missing, stopping.' }

# 3. pages you manage; the page token from a long-lived user token does not expire
$pages = @((Invoke-RestMethod "$G/me/accounts?fields=id,name,access_token&access_token=$long").data)
Remove-Variable long
if ($pages.Count -eq 0) { throw 'No pages returned. Tick your page when Facebook asks which pages to allow.' }

Write-Host "`nPages you manage:"
for ($i = 0; $i -lt $pages.Count; $i++) { Write-Host ("  [{0}] {1}   (id {2})" -f ($i + 1), $pages[$i].name, $pages[$i].id) }
$pick = [int](Read-Host "`nWhich number is the page to post on") - 1
$page = $pages[$pick]

Set-Clipboard -Value $page.access_token
Write-Host "`nFB_PAGE_ID    = $($page.id)   (a plain number, safe to type)" -ForegroundColor Cyan
Write-Host "FB_PAGE_TOKEN = copied to your clipboard (not shown)." -ForegroundColor Cyan
Write-Host "`nNow open https://github.com/sahadat130/bazar-nojor/settings/secrets/actions"
Write-Host "  1. FB_PAGE_ID    -> paste the number above"
Write-Host "  2. FB_PAGE_TOKEN -> press Ctrl+V (it is on the clipboard)"
Read-Host "`nPress Enter once both secrets are saved (this clears the clipboard)"
Set-Clipboard -Value ' '
