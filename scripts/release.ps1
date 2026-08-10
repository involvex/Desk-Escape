Write-Host "Patching Version in package.json"
bun pm version patch

Write-Host "Generating Changelog"
bun run changelog

Write-Host "Running Pre-Release Build"
bun run check
bunx expo prebuild --platform android
bunx expo run:android --variant release --no-bundler --no-install

Write-Host "Committing Changes"
git add .
git commit -m "chore(release): $(bun pm version)"

Write-Host "Pushing Tag to Remote"
git push
git push --tags