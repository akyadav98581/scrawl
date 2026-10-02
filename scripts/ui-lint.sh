#!/usr/bin/env bash
# Rules from the minimalist-ui skill plus a few writing tells. Fails on the first group with hits.
cd "$(dirname "$0")/.." || exit 1
fail=0
scan() { # label, pattern, paths...
  local label=$1 pat=$2; shift 2
  local hits
  hits=$(grep -rnP --exclude-dir=node_modules --exclude=ui-lint.sh "$pat" "$@" 2>/dev/null)
  if [ -n "$hits" ]; then echo "BANNED ($label):"; echo "$hits" | head -5; fail=1; fi
}
UI="src index.html public"
ALL="src server scripts test index.html README.md render.yaml"
scan "icon library"   'lucide|feather-icons|heroicons|react-icons'                      $UI package.json
scan "typeface"       "\\b(Inter|Roboto|Open Sans)\\b"                                    $UI
scan "heavy shadow"   'shadow-(md|lg|xl|2xl)|box-shadow:\s*[^;]*0\.[1-9]'                  $UI
scan "gradient"       'gradient\('                                                         $UI
scan "emoji"          '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]'                             $ALL
scan "em dash"        '\x{2014}'                                                           $ALL
scan "curly quotes"   '[\x{2018}\x{2019}\x{201C}\x{201D}]'                                 $ALL
scan "ai vocabulary"  '\b(delve|leverage|seamless|robust|elevate|unleash|game-changer|cutting-edge)\b' $ALL
scan "pill container" 'rounded-full[^"]*(w-\[?[0-9]{3}|min-h-)'                            $UI
[ $fail -eq 0 ] && echo UI_LINT_OK
exit $fail
