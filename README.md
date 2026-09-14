# Aplyer Foundation

Aplyer.ai Chrome Extension - Milestone 1 (Production Ready Foundation)

You are a world-class Product Designer, UX Architect, Senior React Engineer, Chrome Extension Engineer, and SaaS Product Builder.

Your goal is to build the complete production-ready Milestone 1 foundation for Aplyer.ai.

This is NOT a landing page.

This is the actual Chrome Extension experience users will install and use.

The design must feel like a premium AI SaaS product and match the existing Aplyer.ai brand identity exactly.

Product Overview

Aplyer.ai helps job seekers complete job applications faster.

The extension eventually:

Detects ATS job applications

Reads application questions

Uses the user's resume

Uses optional writing samples

Generates personalized answers

Autofills application forms

However NONE of those AI features should be implemented in Milestone 1.

Milestone 1 is strictly focused on:

Extension shell

User onboarding

Resume upload

Resume quality scoring foundation

Optional writing samples upload

User profile creation

Local storage architecture

Settings foundation

Premium branded experience

The entire system must be built as if it will go live tomorrow.

USER JOURNEY

Design the onboarding exactly as follows.

Step 1:

Welcome

↓

Step 2:

Upload Resume

↓

Step 3:

Resume Analysis & Resume Score

↓

Step 4:

Profile Information

↓

Step 5:

Optional Writing Samples

↓

Step 6:

Success & Ready State

↓

Dashboard Home

This flow is mandatory.

BRAND SYSTEM

Use these exact brand colors.

Background:

#080F1A

Cards:

#0D1829

Secondary Surface:

#122038

Primary Green:

#1DB954

Primary Red:

#E5373A

Primary Text:

#F5F5F5

Secondary Text:

#E2E2E2

Muted Text:

#9BA3AE

Success:

#22C55E

The extension should feel like a premium extension of the existing Aplyer.ai landing page.

Think:

Linear

Arc

Perplexity

Cursor

Stripe

Notion AI

Not generic admin dashboards.

EXTENSION DIMENSIONS

Width:

420px

Height:

650px

Optimized for Chrome Extension Popup.

STEP 1 — WELCOME SCREEN

Logo

Aplyer.ai

Headline:

Stop Skipping Jobs.

Subheadline:

Apply and sound like yourself on every application.

Description:

Upload your resume once and let Aplyer assist you across supported job applications.

CTA:

Get Started

Footer:

Supports Workday, Greenhouse, Lever

Use subtle motion effects.

STEP 2 — RESUME UPLOAD

Allow:

PDF

DOCX

Drag and Drop Area

Upload States:

Idle

Uploading

Success

Error

Display:

File Name

Upload Date

File Size

Storage Status

After upload:

Extract text

Store locally

Create parsing abstraction layer

Use:

chrome.storage.local

Build production architecture.

No backend.

No API.

STEP 3 — RESUME ANALYSIS

This screen should feel intelligent.

IMPORTANT:

Do not use AI.

Do not call APIs.

Generate a local Resume Readiness Score.

Score Range:

0-100

Use placeholder local logic:

Resume length

Detected sections

Contact info

Experience section

Skills section

Education section

Display:

Resume Score

Resume Strength Meter

Resume Completeness

Professional Readiness

Create a beautiful dashboard.

Example:

Resume Score:

82/100

Strengths:

✓ Contact Information

✓ Experience

✓ Skills

Suggestions:

• Add Certifications

• Add Portfolio Link

• Add More Quantifiable Achievements

Make this screen look extremely premium.

Use animations.

Use progress rings.

Use metric cards.

This should become one of the strongest screens in the extension.

STEP 4 — PROFILE SETUP

Collect:

First Name

Last Name

Email

Phone

LinkedIn URL

Portfolio URL

Current Location

Store everything locally.

Validation required.

These fields will later be used for automatic job application autofill.

STEP 5 — OPTIONAL WRITING SAMPLES

This step is OPTIONAL.

User may:

Skip

or

Continue

Headline:

Help Aplyer Learn Your Voice

Description:

Upload previous writing samples to improve future personalization.

Allow:

Cover Letters

Professional Emails

Personal Bio

Career Summary

Paste Text Area

Max Length:

10,000 characters

Store locally.

No AI analysis.

No processing.

Only save.

Create architecture for future milestones.

Display:

Writing Sample Count

Total Words

Saved Status

STEP 6 — SUCCESS SCREEN

Large success animation.

Message:

You're Ready.

Subheadline:

Aplyer is now prepared to assist you when you visit supported job applications.

Show:

Resume Uploaded ✓

Profile Completed ✓

Writing Samples Saved ✓ or Skipped

Button:

Go To Dashboard

DASHBOARD HOME

Create a production-ready dashboard.

This becomes the default extension view after onboarding.

Cards:

Resume Status

Resume Score

Profile Completion

Writing Samples

Subscription Status

Supported Platforms

Quick Actions

Show:

Greenhouse

Lever

Workday

Badges

No AI functionality yet.

SETTINGS PAGE

Build full UI.

Sections:

Account

Resume

Profile

Writing Samples

Subscription

AI Provider

Support

Privacy

All visually complete.

No backend.

SUBSCRIPTION FOUNDATION

UI only.

Plans:

Free

Pro

Enterprise

Display locked premium features.

Future billing integration ready.

AI PROVIDER FOUNDATION

Create future provider settings.

Options:

Claude Sonnet

OpenAI GPT

Gemini

Display:

Current Provider

Provider Status

Provider Description

No functionality.

Only architecture.

LOCAL STORAGE REQUIREMENTS

Must use:

chrome.storage.local

Store:

resumeText

resumeMetadata

resumeScore

resumeSuggestions

profile

writingSamples

subscriptionStatus

settings

onboardingStatus

lastUpdated

Create reusable storage service.

Create TypeScript interfaces.

Create hooks.

Create utilities.

Production architecture only.

ANIMATIONS

Use Framer Motion.

Required:

Page transitions

Success animations

Progress animations

Score animations

Hover states

Loading skeletons

Smooth onboarding transitions

Premium feel.

No excessive motion.

CODE REQUIREMENTS

React

TypeScript

TailwindCSS

Framer Motion

Manifest V3

Reusable Components

Clean Architecture

Scalable Folder Structure

Production Quality

No mock spaghetti code.

No quick hacks.

No placeholder UI kits.

IMPORTANT

DO NOT BUILD:

ATS Scraping

Workday Detection

Greenhouse Detection

Lever Detection

AI Answer Generation

Claude Integration

OpenAI Integration

Backend APIs

Payments

Authentication

Focus entirely on building the most polished onboarding and extension foundation possible while maintaining the exact Aplyer.ai visual identity and preparing the architecture for future milestones. also share some file which can help you to understand the colour theme an all

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://aplyer.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/6e7c94e2-66c5-41bc-8e4d-e42fa5d94383).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
