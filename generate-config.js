// @ts-check
// this script generates CircleCI config file by looking at the "base/*" folders
// for each subfolder it creates a separate job
const globby = require('globby');
const fs = require('fs')
const path = require('path')
const os = require('os')
const semver = require('semver')

const preamble = `
# WARNING: this file is automatically generated by ${path.basename(__filename)}
# info on building Docker images on Circle
# https://circleci.com/docs/2.0/building-docker-images/
version: 2.1

orbs:
  node: circleci/node@1.1

commands:
  halt-on-branch:
    description: Halt current CircleCI job if not on master branch
    steps:
      - run:
          name: Halting job if not on master branch
          command: |
            if [[ "$CIRCLE_BRANCH" != "master" ]]; then
              echo "Not master branch, will skip the rest of commands"
              circleci-agent step halt
            else
              echo "On master branch, can continue"
            fi

  halt-if-docker-image-exists:
    description: Halt current CircleCI job if Docker image exists already
    parameters:
      imageName:
        type: string
        description: Docker image name to test
    steps:
      - run:
          name: Check if image << parameters.imageName >> exists or Docker hub does not respond
          # using https://github.com/cypress-io/docker-image-not-found
          # to check if Docker hub definitely does not have this image
          command: |
            if npx docker-image-not-found --repo << parameters.imageName >>; then
              echo Docker hub says image << parameters.imageName >> does not exist
            else
              echo Docker hub has image << parameters.imageName >> or not responding
              echo We should stop in this case
              circleci-agent step halt
            fi

  test-base-image:
    description: Build a test image from base image and test it
    parameters:
      nodeVersion:
        type: string
        description: Node version to expect in the base image, starts with "v"
      imageName:
        type: string
        description: Cypress base docker image to test
      checkNodeVersion:
        type: boolean
        description: Check if the FROM image name is strict Node version
        default: true
    steps:
      - when:
          condition: << parameters.checkNodeVersion >>
          steps:
          - run:
              name: confirm image has Node << parameters.nodeVersion >>
              # do not run Docker in the interactive mode - adds control characters!
              command: |
                version=$(docker run << parameters.imageName >> node --version)
                if [ "$version" == "<< parameters.nodeVersion >>" ]; then
                  echo "Base image has the expected version of Node << parameters.nodeVersion >>";
                else
                  echo "Problem: base image has unexpected Node version"
                  echo "Expected << parameters.nodeVersion >> and got $version"
                  exit 1
                fi
      - run:
          name: test image << parameters.imageName >>
          no_output_timeout: '3m'
          command: |
            docker build -t cypress/test -\\<<EOF
            FROM << parameters.imageName >>
            RUN echo "current user: $(whoami)"
            ENV CI=1
            RUN npm init --yes
            RUN npm install --save-dev cypress cypress-expect
            RUN ./node_modules/.bin/cypress verify
            RUN npx @bahmutov/cly init
            # run Cypress by itself
            RUN ./node_modules/.bin/cypress run
            # run Cypress using module API and confirm number of passing tests
            RUN ./node_modules/.bin/cypress-expect run --passing 1
            EOF

      - run:
          name: test image << parameters.imageName >> using Kitchensink
          no_output_timeout: '3m'
          command: |
            docker build -t cypress/test-kitchensink -\\<<EOF
            FROM << parameters.imageName >>
            RUN echo "current user: $(whoami)"
            ENV CI=1
            ENV CYPRESS_INTERNAL_FORCE_SCAFFOLD=1
            RUN npm init --yes
            RUN npm install --save-dev cypress cypress-expect
            RUN ./node_modules/.bin/cypress verify
            RUN echo '{}' > cypress.json
            # run Cypress and confirm minimum number of passing tets
            RUN ./node_modules/.bin/cypress-expect run --min-passing 100
            EOF

  test-browser-image:
    description: Build a test image from browser image and test it
    parameters:
      imageName:
        type: string
        description: Cypress browser docker image to test
      chromeVersion:
        type: string
        default: ''
        description: Chrome version to expect in the base image, starts with "Google Chrome XX"
      firefoxVersion:
        type: string
        default: ''
        description: Firefox version to expect in the base image, starts with "Mozilla Firefox XX"
      edgeVersion:
        type: string
        default: ''
        description: Edge version to expect in the base image, starts with "Microsoft Edge XX"
    steps:
      - when:
          condition: << parameters.chromeVersion >>
          steps:
          - run:
              name: confirm image has Chrome << parameters.chromeVersion >>
              # do not run Docker in the interactive mode - adds control characters!
              # and use Bash regex string comparison
              command: |
                version=$(docker run << parameters.imageName >> google-chrome --version)
                if [[ "$version" =~ ^"<< parameters.chromeVersion >>" ]]; then
                  echo "Image has the expected version of Chrome << parameters.chromeVersion >>"
                  echo "found $version"
                else
                  echo "Problem: image has unexpected Chrome version"
                  echo "Expected << parameters.chromeVersion >> and got $version"
                  exit 1
                fi

      - when:
          condition: << parameters.firefoxVersion >>
          steps:
          - run:
              name: confirm the image has Firefox << parameters.firefoxVersion >>
              command: |
                version=$(docker run << parameters.imageName >> firefox --version)
                if [[ "$version" =~ ^"<< parameters.firefoxVersion >>" ]]; then
                  echo "Image has the expected version of Firefox << parameters.firefoxVersion >>"
                  echo "found $version"
                else
                  echo "Problem: image has unexpected Firefox version"
                  echo "Expected << parameters.firefoxVersion >> and got $version"
                  exit 1
                fi

      - when:
          condition: << parameters.edgeVersion >>
          steps:
          - run:
              name: confirm the image has Edge << parameters.edgeVersion >>
              command: |
                version=$(docker run << parameters.imageName >> edge --version)
                if [[ "$version" =~ ^"<< parameters.edgeVersion >>" ]]; then
                  echo "Image has the expected version of Edge << parameters.edgeVersion >>"
                  echo "found $version"
                else
                  echo "Problem: image has unexpected Edge version"
                  echo "Expected << parameters.edgeVersion >> and got $version"
                  exit 1
                fi

      - run:
          name: test image << parameters.imageName >>
          no_output_timeout: '3m'
          command: |
            docker build -t cypress/test -\\<<EOF
            FROM << parameters.imageName >>
            RUN echo "current user: $(whoami)"
            ENV CI=1
            RUN npm init --yes
            RUN npm install --save-dev cypress
            RUN ./node_modules/.bin/cypress verify
            RUN npx @bahmutov/cly init
            EOF

      - run:
          name: Test built-in Electron browser
          no_output_timeout: '1m'
          command: docker run cypress/test ./node_modules/.bin/cypress run

      - when:
          condition: << parameters.chromeVersion >>
          steps:
          - run:
              name: Test << parameters.chromeVersion >>
              no_output_timeout: '1m'
              command: docker run cypress/test ./node_modules/.bin/cypress run --browser chrome

      - when:
          condition: << parameters.firefoxVersion >>
          steps:
          - run:
              name: Test << parameters.firefoxVersion >>
              no_output_timeout: '1m'
              command: docker run cypress/test ./node_modules/.bin/cypress run --browser firefox

      - when:
          condition: << parameters.edgeVersion >>
          steps:
          - run:
              name: Test << parameters.edgeVersion >>
              no_output_timeout: '1m'
              command: docker run cypress/test ./node_modules/.bin/cypress run --browser edge

      - run:
          name: scaffold image << parameters.imageName >> using Kitchensink
          no_output_timeout: '3m'
          command: |
            docker build -t cypress/test-kitchensink -\\<<EOF
            FROM << parameters.imageName >>
            RUN echo "current user: $(whoami)"
            ENV CI=1
            ENV CYPRESS_INTERNAL_FORCE_SCAFFOLD=1
            RUN npm init --yes
            RUN npm install --save-dev cypress
            RUN ./node_modules/.bin/cypress verify
            RUN echo '{}' > cypress.json
            EOF

      - when:
          condition: << parameters.chromeVersion >>
          steps:
          - run:
              name: Test << parameters.chromeVersion >>
              no_output_timeout: '1m'
              command: docker run cypress/test-kitchensink ./node_modules/.bin/cypress run --browser chrome

      - when:
          condition: << parameters.firefoxVersion >>
          steps:
          - run:
              name: Test << parameters.firefoxVersion >>
              no_output_timeout: '1m'
              command: docker run cypress/test-kitchensink ./node_modules/.bin/cypress run --browser firefox

      - when:
          condition: << parameters.edgeVersion >>
          steps:
          - run:
              name: Test << parameters.edgeVersion >>
              no_output_timeout: '1m'
              command: docker run cypress/test-kitchensink ./node_modules/.bin/cypress run --browser edge

  test-included-image-versions:
    description: Testing pre-installed versions
    parameters:
      cypressVersion:
        type: string
        description: Cypress version to test, like "4.0.0"
      imageName:
        type: string
        description: Cypress included docker image to test
    steps:
      - run:
          name: 'Print versions'
          command: docker run -it --entrypoint cypress cypress/included:<< parameters.cypressVersion >> version

      - run:
          name: 'Print info'
          command: docker run -it --entrypoint cypress cypress/included:<< parameters.cypressVersion >> info

      - run:
          name: 'Check Node version'
          command: |
            export NODE_VERSION=$(docker run --entrypoint node cypress/included:<< parameters.cypressVersion >> --version)
            export CYPRESS_NODE_VERSION=$(docker run --entrypoint cypress cypress/included:<< parameters.cypressVersion >> version --component node)
            echo "Included Node $NODE_VERSION"
            echo "Cypress includes Node $CYPRESS_NODE_VERSION"
            # "node --version" returns something like "v12.1.2"
            # and "cypres version ..." returns just "12.1.2"
            if [ "$NODE_VERSION" = "v$CYPRESS_NODE_VERSION" ]; then
              echo "Node versions match"
            else
              echo "Node version mismatch 🔥"
              # TODO make sure there are no extra characters in the versions
              # https://github.com/cypress-io/cypress-docker-images/issues/411
              # exit 1
            fi

  test-included-image:
    description: Testing Docker image with Cypress pre-installed
    parameters:
      cypressVersion:
        type: string
        description: Cypress version to test, like "4.0.0"
      imageName:
        type: string
        description: Cypress included docker image to test
    steps:
      - run:
          name: New test project and testing
          no_output_timeout: '3m'
          command: |
            node --version
            mkdir test
            cd test
            echo "Initializing test project"
            npx @bahmutov/cly init --cypress-version << parameters.cypressVersion >>

            echo "Testing using Electron browser"
            docker run -it -v $PWD:/e2e -w /e2e cypress/included:<< parameters.cypressVersion >>

            echo "Testing using Chrome browser"
            docker run -it -v $PWD:/e2e -w /e2e cypress/included:<< parameters.cypressVersion >> --browser chrome
          working_directory: /tmp

  test-included-image-using-kitchensink:
    description: Testing Cypress pre-installed using Kitchensink
    parameters:
      cypressVersion:
        type: string
        description: Cypress version to test, like "4.0.0"
      imageName:
        type: string
        description: Cypress included docker image to test
    steps:
      - run:
          name: Testing Kitchensink
          no_output_timeout: '3m'
          command: |
            node --version
            mkdir test-kitchensink
            cd test-kitchensink

            npm init -y
            echo '{}' > cypress.json

            echo "Testing using Electron browser"
            docker run -it -v $PWD:/e2e -w /e2e -e CYPRESS_INTERNAL_FORCE_SCAFFOLD=1 cypress/included:<< parameters.cypressVersion >>

            echo "Testing using Chrome browser"
            docker run -it -v $PWD:/e2e -w /e2e -e CYPRESS_INTERNAL_FORCE_SCAFFOLD=1 cypress/included:<< parameters.cypressVersion >> --browser chrome

          working_directory: /tmp

  docker-push:
    description: Log in and push a given image to Docker hub
    parameters:
      imageName:
        type: string
        description: Docker image name to push
    steps:
      # before pushing, let's check again that the Docker Hub does not have the image
      # accidental rebuild and overwrite of an image is bad, since it can bump every tool
      # https://github.com/cypress-io/cypress/issues/6335
      - halt-if-docker-image-exists:
          imageName: << parameters.imageName >>
      - run:
          name: Pushing image << parameters.imageName >> to Docker Hub
          command: |
            echo "$DOCKERHUB_PASS" | docker login -u "$DOCKERHUB_USERNAME" --password-stdin
            docker push << parameters.imageName >>

jobs:
  lint-markdown:
    executor:
      name: node/default
      tag: '12'
    steps:
      - checkout
      - node/with-cache:
          steps:
            - run: npm ci
      - run: npm run check:markdown

  build-base-image:
    machine: true
    parameters:
      dockerName:
        type: string
        description: Image name to build
        default: cypress/base
      dockerTag:
        type: string
        description: Image tag to build like "12.14.0"
      checkNodeVersion:
        type: boolean
        description: Check if the FROM image name is strict Node version
        default: true
    steps:
      - checkout
      - halt-if-docker-image-exists:
          imageName: << parameters.dockerName >>:<< parameters.dockerTag >>
      - run:
          name: building Docker image << parameters.dockerName >>:<< parameters.dockerTag >>
          command: |
            docker build -t << parameters.dockerName >>:<< parameters.dockerTag >> .
          working_directory: base/<< parameters.dockerTag >>

      - test-base-image:
          nodeVersion: v<< parameters.dockerTag >>
          imageName: << parameters.dockerName >>:<< parameters.dockerTag >>
          checkNodeVersion: << parameters.checkNodeVersion >>
      - halt-on-branch
      - docker-push:
          imageName: << parameters.dockerName >>:<< parameters.dockerTag >>

  build-browser-image:
    machine: true
    parameters:
      dockerName:
        type: string
        description: Image name to build
        default: cypress/browsers
      dockerTag:
        type: string
        description: Image tag to build like "node12.4.0-chrome76"
      chromeVersion:
        type: string
        default: ''
        description: Chrome version to expect in the base image, starts with "Google Chrome XX"
      firefoxVersion:
        type: string
        default: ''
        description: Firefox version to expect in the base image, starts with "Mozilla Firefox XX"
      edgeVersion:
        type: string
        default: ''
        description: Edge version to expect in the base image, starts with "Microsoft Edge XX"
    steps:
      - checkout
      - halt-if-docker-image-exists:
          imageName: << parameters.dockerName >>:<< parameters.dockerTag >>
      - run:
          name: building Docker image << parameters.dockerName >>:<< parameters.dockerTag >>
          command: |
            docker build -t << parameters.dockerName >>:<< parameters.dockerTag >> .
          working_directory: browsers/<< parameters.dockerTag >>
      - test-browser-image:
          imageName: << parameters.dockerName >>:<< parameters.dockerTag >>
          chromeVersion: << parameters.chromeVersion >>
          firefoxVersion: << parameters.firefoxVersion >>
          edgeVersion: << parameters.edgeVersion >>
      - halt-on-branch
      - docker-push:
          imageName: << parameters.dockerName >>:<< parameters.dockerTag >>

  build-included-image:
    machine: true
    parameters:
      dockerName:
        type: string
        description: Image name to build
        default: cypress/included
      dockerTag:
        type: string
        description: Image tag to build, should match Cypress version, like "3.8.1"
    steps:
      - checkout
      # temporarily in this PR
      # - halt-if-docker-image-exists:
      #    imageName: << parameters.dockerName >>:<< parameters.dockerTag >>
      - run:
          name: building Docker image << parameters.dockerName >>:<< parameters.dockerTag >>
          command: |
            docker build -t << parameters.dockerName >>:<< parameters.dockerTag >> .
          working_directory: included/<< parameters.dockerTag >>

      - test-included-image-versions:
          cypressVersion: << parameters.dockerTag >>
          imageName: << parameters.dockerName >>:<< parameters.dockerTag >>

      - test-included-image:
          cypressVersion: << parameters.dockerTag >>
          imageName: << parameters.dockerName >>:<< parameters.dockerTag >>

      - test-included-image-using-kitchensink:
          cypressVersion: << parameters.dockerTag >>
          imageName: << parameters.dockerName >>:<< parameters.dockerTag >>

      - halt-on-branch
      - docker-push:
          imageName: << parameters.dockerName >>:<< parameters.dockerTag >>

workflows:
  version: 2
  lint:
    jobs:
      - lint-markdown
`

const formBaseWorkflow = (baseImages) => {
  // skip images that already have been built
  // one can update this list if the number of
  // build jobs in circleci grows too long
  const skipImages = [
    '6',
    '8',
    '8.0.0',
    '8.15.1',
    '8.16.0',
    '8.2.1',
    '8.9.3',
    '8.9.3-npm-6.10.1',
    '10',
    '10.0.0',
    '10.11.0',
    '10.15.3',
    '10.16.0',
    '10.16.3',
    '10.18.0',
    '10.18.1',
    '10.2.1',
    '11.13.0',
    '12.0.0',
    '12.1.0',
    '12.12.0',
    '12.13.0',
    '12.14.0',
    '12.14.1',
    '12.16.0',
    '12.16.1',
    '12.16.2',
    '12.18.0',
    '12.18.2',
    '12.4.0',
    '12.6.0',
    '12.8.1',
    '13.1.0',
    '13.3.0',
    '13.6.0',
    '13.8.0',
    '14.0.0',
    'centos7',
    'centos7-12.4.0',
    'ubuntu16',
    'ubuntu16-12.13.1',
    'ubuntu16-8',
    'ubuntu18-node12.14.1',
    'ubuntu19-node12.14.1'
  ]
  const isSkipped = (tag) => skipImages.includes(tag)
  const isIncluded = (imageAndTag) => !isSkipped(imageAndTag.tag)

  const yml = baseImages.filter(isIncluded).map(imageAndTag => {
    // important to have indent
    let job = '      - build-base-image:\n' +
      `          name: "base ${imageAndTag.tag}"\n` +
      `          dockerTag: "${imageAndTag.tag}"\n`
    // do not check Node versions in some custom images
    if (imageAndTag.tag === '12.0.0-libgbm' || imageAndTag.tag === 'manjaro-14.12.0') {
      job += '          checkNodeVersion: false\n'
    }
    return job
  })

  // indent is important
  const workflowName = '  build-base-images:\n' +
    '    jobs:\n'

  const text = workflowName + yml.join('')
  return text
}

const fullChromeVersion = (version) =>
  `Google Chrome ${version}`

const fullFirefoxVersion = (version) =>
  `Mozilla Firefox ${version}`

const fullEdgeVersion = (version) =>
  `Microsoft Edge ${version}`

const findChromeVersion = (imageAndTag) => {
  // image name like "nodeX.Y.Z-chromeXX..."
  // the folder has "chromeXX" name, so extract the "XX" part
  const matches = /chrome(\d+)/.exec(imageAndTag)
  if (matches && matches[1]) {
    return fullChromeVersion(matches[1])
  }

  return null
}

const findFirefoxVersion = (imageAndTag) => {
  // image name like "nodeX.Y.Z-chromeXX-ffYY..."
  // the folder has "ffYY" name, so extract the "YY" part
  const matches = /-ff(\d+)/.exec(imageAndTag)
  if (matches && matches[1]) {
    return fullFirefoxVersion(matches[1])
  }

  return null
}

const findEdgeVersion = (imageAndTag) => {
  // image name like "nodeX.Y.Z-edgeXX"
  // so we will extract "XX" part
  const matches = /-edge(\d+)/.exec(imageAndTag)
  if (matches && matches[1]) {
    return fullEdgeVersion(matches[1])
  }

  return null
}

const formBrowserWorkflow = (browserImages) => {
  // not every browser image can be tested
  // some old images do not have NPX for example
  // so let them be
  const skipImages = [
    'chrome63-ff57',
    'chrome65-ff57',
    'chrome67',
    'chrome67-ff57',
    'chrome69',
    'node8.15.1-chrome73',
    'node8.2.1-chrome73',
    'node8.9.3-chrome73',
    'node8.9.3-npm6.10.1-chrome75',
    'node8.9.3-npm6.10.1-chrome76-ff68',
    'node10.11.0-chrome75',
    'node10.16.0-chrome76',
    'node10.16.0-chrome77',
    'node10.16.0-chrome77-ff71',
    'node10.16.3-chrome80-ff73',
    'node10.2.1-chrome74',
    'node11.13.0-chrome73',
    'node12.0.0-chrome73',
    'node12.0.0-chrome73-ff68',
    'node12.0.0-chrome75',
    'node12.13.0-chrome78-ff70',
    'node12.13.0-chrome78-ff70-brave78',
    'node12.13.0-chrome80-ff73',
    'node12.13.0-chrome80-ff74',
    'node12.14.0-chrome79-ff71',
    'node12.14.1-chrome83-ff77',
    'node12.16.1-chrome80-ff73',
    'node12.16.2-chrome81-ff75',
    'node12.18.0-chrome83-ff77',
    'node12.4.0-chrome76',
    'node12.6.0-chrome75',
    'node12.6.0-chrome77',
    'node12.8.1-chrome78-ff70',
    'node12.8.1-chrome80-ff72',
    'node13.1.0-chrome78-ff70',
    'node13.3.0-chrome79-ff70',
    'node13.6.0-chrome80-ff72'
  ]
  const isSkipped = (tag) => skipImages.includes(tag)
  const isIncluded = (imageAndTag) => !isSkipped(imageAndTag.tag)

  const yml = browserImages.filter(isIncluded).map(imageAndTag => {
    const chromeVersion = findChromeVersion(imageAndTag.tag)
    const firefoxVersion = findFirefoxVersion(imageAndTag.tag)
    const edgeVersion = findEdgeVersion(imageAndTag.tag)
    const foundBrowser = chromeVersion || firefoxVersion || edgeVersion

    if (!foundBrowser) {
      throw new Error(`Cannot find any browsers from image tag "${imageAndTag.tag}"`)
    }

    // important to have indent
    let job = '      - build-browser-image:\n' +
      `          name: "browsers ${imageAndTag.tag}"\n` +
      `          dockerTag: "${imageAndTag.tag}"\n`

    if (chromeVersion) {
      job += `          chromeVersion: "${chromeVersion}"\n`
    }

    if (firefoxVersion) {
      job += `          firefoxVersion: "${firefoxVersion}"\n`
    }

    if (edgeVersion) {
      job += `          edgeVersion: "${edgeVersion}"\n`
    }

    return job
  })

  // indent is important
  const workflowName = '  build-browser-images:\n' +
    '    jobs:\n'

  const text = workflowName + yml.join('')
  return text
}

const formIncludedWorkflow = (images) => {
  // skip images that have been built already
  const isSkipped = (tag) => {
    return semver.lt(tag, '6.0.0')
  }
  const isIncluded = (imageAndTag) => !isSkipped(imageAndTag.tag)

  const yml = images.filter(isIncluded).map(imageAndTag => {
    // important to have indent
    const job = '      - build-included-image:\n' +
      `          name: "included ${imageAndTag.tag}"\n` +
      `          dockerTag: "${imageAndTag.tag}"\n`
    return job
  })

  // indent is important
  const workflowName = '  build-included-images:\n' +
    '    jobs:\n'

  const text = workflowName + yml.join('')
  return text
}

const writeConfigFile = (baseImages, browserImages, includedImages) => {
  const base = formBaseWorkflow(baseImages)
  const browsers = formBrowserWorkflow(browserImages)
  const included = formIncludedWorkflow(includedImages)

  const text = preamble.trim() + os.EOL + base + os.EOL + browsers + os.EOL + included
  fs.writeFileSync('circle.yml', text, 'utf8')
  console.log('generated circle.yml')
}

const splitImageFolderName = (folderName) => {
  const [name, tag] = folderName.split('/')
  return {
    name,
    tag
  }
}

(async () => {
  const basePaths = await globby('base/*', {onlyDirectories: true});
  const base = basePaths.map(splitImageFolderName)
  console.log(' *** base images ***')
  console.log(base)

  const browsersPaths = await globby('browsers/*', {onlyDirectories: true});
  const browsers = browsersPaths.map(splitImageFolderName)
  console.log(' *** browser images ***')
  console.log(browsers)

  const includedPaths = await globby('included/*', {onlyDirectories: true});
  const included = includedPaths.map(splitImageFolderName)
  console.log(' *** included images ***')
  console.log(included)

  writeConfigFile(base, browsers, included)
})();
