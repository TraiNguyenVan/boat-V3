const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const MASTER_FILE = path.join(ROOT_DIR, 'AGENTS.md');

function run() {
  if (!fs.existsSync(MASTER_FILE)) {
    console.error(`Error: Master file not found at ${MASTER_FILE}`);
    process.exit(1);
  }

  console.log('Reading master rules file (AGENTS.md)...');
  const masterContent = fs.readFileSync(MASTER_FILE, 'utf8');

  // Define targets and their specific customizations
  const targets = [
    {
      filepath: path.join(ROOT_DIR, 'GEMINI.md'),
      transform: (content) => {
        return content
          .replace(
            '# Agent Instructions & Guidelines - Boat GPS Server',
            '# Gemini Assistant Instructions & Guidelines - Boat GPS Server'
          )
          .replace(
            'AI coding agents working on',
            'the Gemini assistant and other AI coding agents working on'
          );
      }
    },
    {
      filepath: path.join(ROOT_DIR, 'CLAUDE.md'),
      transform: (content) => {
        return content
          .replace(
            '# Agent Instructions & Guidelines - Boat GPS Server',
            '# Claude Assistant Instructions & Guidelines - Boat GPS Server'
          )
          .replace(
            'AI coding agents working on',
            'the Claude assistant and other AI coding agents working on'
          );
      }
    },
    {
      filepath: path.join(ROOT_DIR, '.cursorrules'),
      transform: (content) => {
        return content
          .replace(
            '# Agent Instructions & Guidelines - Boat GPS Server',
            '# Cursor Assistant Instructions & Guidelines - Boat GPS Server'
          )
          .replace(
            'AI coding agents working on',
            'Cursor and other AI coding agents working on'
          );
      }
    },
    {
      filepath: path.join(ROOT_DIR, '.cursor', 'rules', 'boat-gps.mdc'),
      transform: (content) => {
        const header = `---
description: "Boat GPS Server core instructions, failsafes, rules, and post-feature workflow guidelines."
globs: ["*"]
alwaysApply: true
---

`;
        const transformedBody = content
          .replace(
            '# Agent Instructions & Guidelines - Boat GPS Server',
            '# Cursor Assistant Rules - Boat GPS Server'
          )
          .replace(
            'AI coding agents working on',
            'Cursor and other AI coding agents working on'
          );
        return header + transformedBody;
      }
    },
    {
      filepath: path.join(ROOT_DIR, '.github', 'copilot-instructions.md'),
      transform: (content) => {
        return content
          .replace(
            '# Agent Instructions & Guidelines - Boat GPS Server',
            '# GitHub Copilot Instructions & Guidelines - Boat GPS Server'
          )
          .replace(
            'AI coding agents working on',
            'GitHub Copilot and other AI coding agents working on'
          );
      }
    }
  ];

  let successCount = 0;

  for (const target of targets) {
    try {
      const targetDir = path.dirname(target.filepath);
      if (!fs.existsSync(targetDir)) {
        console.log(`Creating directory: ${targetDir}`);
        fs.mkdirSync(targetDir, { recursive: true });
      }

      console.log(`Generating: ${path.relative(ROOT_DIR, target.filepath)}...`);
      const transformedContent = target.transform(masterContent);
      fs.writeFileSync(target.filepath, transformedContent, 'utf8');
      successCount++;
    } catch (err) {
      console.error(`Failed to write to ${target.filepath}:`, err);
    }
  }

  console.log(`\nRule synchronization complete! Successfully updated ${successCount}/${targets.length} files.`);
}

run();
