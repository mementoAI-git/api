#!/usr/bin/env bash
set -euo pipefail
cd /source
scripts/fetch-vendor.sh
# Restrict build parallelism; this is not a server workload.
sed -i 's/-j "$(nproc)"/-j 2/g' scripts/build-llama.sh
scripts/build-llama.sh
swift build -c release --product digup -j 2
mkdir -p /bundle/lib /bundle/licenses
cp .build/release/digup /bundle/digup.bin
cp -a Vendor/llama/lib/*.so* Vendor/pdfium/lib/*.so* /bundle/lib/
# Include Swift and third-party runtime libraries, preserving the host's libc/loader.
for file in /bundle/digup.bin /bundle/lib/*.so*; do
  while read -r library; do
    case "$library" in
      */libc.so.*|*/libm.so.*|*/libpthread.so.*|*/libdl.so.*|*/librt.so.*|*/ld-linux*|*/libresolv.so.*) continue ;;
    esac
    cp -nL "$library" /bundle/lib/
    package=$(dpkg-query -S "$library" 2>/dev/null | head -1 | cut -d: -f1 || true)
    if [[ -n "$package" && -f "/usr/share/doc/$package/copyright" ]]; then
      cp "/usr/share/doc/$package/copyright" "/bundle/licenses/$package-copyright"
    fi
  done < <(ldd "$file" | awk '/=> \/.* \(/ {print $3}')
done
patchelf --set-rpath '$ORIGIN/lib' /bundle/digup.bin
for file in /bundle/lib/*.so*; do
  if [[ ! -L "$file" ]]; then patchelf --set-rpath '$ORIGIN' "$file"; fi
done
cat > /bundle/digup <<'LAUNCHER'
#!/usr/bin/env bash
set -euo pipefail
base="$(cd -- "$(dirname -- "$0")" && pwd)"
# The worker is the only runtime command this application needs.
if [[ "${1:-}" != worker ]]; then echo 'Only the embedding worker is enabled' >&2; exit 2; fi
export DIGUP_BACKENDS="$base/lib"
export DIGUP_THREADS=2
exec "$base/digup.bin" "$@"
LAUNCHER
chmod 755 /bundle/digup /bundle/digup.bin
cp LICENSE /bundle/licenses/DigUp-LICENSE
cp Vendor/llama.cpp/LICENSE /bundle/licenses/llama.cpp-LICENSE
cp Vendor/pdfium/LICENSE* /bundle/licenses/ 2>/dev/null || true
curl --fail --location --retry 3 'https://raw.githubusercontent.com/swiftlang/swift/swift-6.2-RELEASE/LICENSE.txt' -o /bundle/licenses/Swift-LICENSE
printf '%s\n' "$DIGUP_REVISION" > /bundle/SOURCE_REVISION
ldd /bundle/digup.bin > /bundle/runtime-dependencies.txt
