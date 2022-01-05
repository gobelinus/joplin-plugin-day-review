# VERSION := $(shell jq --raw-output '.version' < src/manifest.json)
# TODO: make this idempotent and cached
build:
	npm run dist

ebuild:
	earthly +build

start: build
	@/Applications/Joplin.app/Contents/MacOS/Joplin --env dev

watch:
	watchexec -i publish -i dist -r -e ts -- make start

tag:
	@./bin/tag-release

clean:
	@rm -rf ./publish && rm -rf ./dist && rm -rf ./*.tgz

release-dry-run: build
	npm release --dry-run

release: build tag
	npm release
