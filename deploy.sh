#!/usr/bin/env sh

# abort on errors
set -e

rm -rf dist

# build
yarn build

# navigate into the build output directory
cd dist

git init
git config user.name "Shenmin Zhou"
git config user.email "shenminzhou@gmail.com"
git add -A
git commit -m 'deploy'

git push -f git@github.com:Shenmin-Z/srt-player.git master:gh-pages

cd -
