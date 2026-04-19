// Heurist.ai AI Service - OpenAI Compatible API
// https://heurist.ai

import OpenAI from 'openai';
import { log } from '../lib/logger';

const HEURIST_BASE_URL = process.env.HEURIST_BASE_URL || 'https://llm-gateway.heurist.xyz';
const HEURIST_API_KEY = process.env.HEURIST_API_KEY || '';

// Available models on Heurist
const AVAILABLE_MODELS = [
  'meta-llama/Llama-3.3-70B-Instruct',
  'meta-llama/Llama-3.1-8B-Instruct',
  'mistralai/Mistral-7B-Instruct-v0.3',
];

const DEFAULT_MODEL = AVAILABLE_MODELS[0];

// Initialize OpenAI client with Heurist base URL
const heuristClient = new OpenAI({
  baseURL: HEURIST_BASE_URL,
  apiKey: HEURIST_API_KEY,
});

interface UserContext {
  portfolioUsd?: number;
  goalsCount?: number;
  densCount?: number;
  level?: number;
  username?: string;
}

const FOXY_SYSTEM_PROMPT = `You are Foxy, a friendly fox mascot for Kitsu DeFi savings app on TON blockchain.
You help users with their savings goals, explain DeFi concepts, and encourage good financial habits.

Personality:
- Friendly, encouraging, and helpful
- Uses fox-themed expressions occasionally (like "By my tail!" or "What does the fox say?")
- Celebrates user achievements enthusiastically
- Explains complex concepts simply and clearly
- Uses emojis moderately (1-2 per response max)

Keep responses concise (under 150 words) and friendly.

=== WALLET ACTIONS ===
When users ask to make transactions, you can help them with these actions:
- "deposit X TON" or "save X TON" → Deposits TON to their Nest Vault
- "withdraw X TON" → Withdraws TON from their Nest Vault
- "swap X TON for USDT" → Uses Omniston to swap tokens
- "send X TON to ADDRESS" → Transfers tokens to another wallet

When a user wants to make a transaction:
1. Acknowledge their request
2. Explain what will happen
3. Ask them to confirm in the app
4. Guide them to click the Confirm button

Example responses:
- For deposit: "Great! Let me help you deposit to your Nest Vault. Click Confirm in the app and I'll process it! 🦊"
- For withdraw: "Sure thing! I can help you withdraw. Just confirm in the app and the tokens will go to your wallet!"
- For swap: "I can swap that for you! The Confirm button will open the swap widget."

Key topics you can help with:
- How Money Dens work (community savings pools with steady or adventurous strategies)
- Setting and tracking savings goals
- TON blockchain basics
- Steady vs Adventurous strategies (Steady = staking, Adventurous = DeFi liquidity pools)
- XP and gamification system
- Making transactions (deposit, withdraw, swap)

If asked about something unrelated to savings, DeFi, or TON, politely redirect to how you can help with their financial journey.`;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function generateFoxyResponse(
  userMessage: string,
  userContext?: UserContext,
  history?: ChatMessage[]
): Promise<string> {
  // Build context-aware system prompt
  let systemPrompt = FOXY_SYSTEM_PROMPT;
  
  if (userContext) {
    const contextParts: string[] = ['\n\nCurrent user context:'];
    
    if (userContext.username) {
      contextParts.push(`- Username: ${userContext.username}`);
    }
    if (userContext.level !== undefined) {
      contextParts.push(`- XP Level: ${userContext.level}`);
    }
    if (userContext.portfolioUsd !== undefined) {
      contextParts.push(`- Portfolio value: $${userContext.portfolioUsd.toFixed(2)}`);
    }
    if (userContext.goalsCount !== undefined) {
      contextParts.push(`- Active savings goals: ${userContext.goalsCount}`);
    }
    if (userContext.densCount !== undefined) {
      contextParts.push(`- Money Dens joined: ${userContext.densCount}`);
    }
    
    if (contextParts.length > 1) {
      systemPrompt += contextParts.join('\n');
      systemPrompt += '\n\nPersonalize your response based on this context.';
    }
  }
  
  try {
    log.ai('Calling Heurist API', { model: DEFAULT_MODEL, messageLength: userMessage.length });
    
    // Build messages array with conversation history
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];
    
    // Add conversation history (last 10 messages to keep context window manageable)
    if (history && history.length > 0) {
      const recentHistory = history.slice(-10);
      for (const msg of recentHistory) {
        messages.push({
          role: msg.role,
          content: msg.content,
        });
      }
    }
    
    // Add current message
    messages.push({ role: 'user', content: userMessage });
    
    const response = await heuristClient.chat.completions.create({
      model: DEFAULT_MODEL,
      messages,
      max_tokens: 250,
      temperature: 0.8,
    });
    
    const reply = response.choices[0]?.message?.content;
    
    if (!reply) {
      log.error('AI', 'Empty response from Heurist');
      throw new Error('Empty AI response');
    }
    
    log.ai('Response received', { replyLength: reply.length });
    return reply;
    
  } catch (error: any) {
    log.error('AI', 'Heurist API error', {
      message: error?.message,
      status: error?.status,
      code: error?.code,
    });
    throw new Error('Failed to get AI response');
  }
}

// Streaming response for future use
export async function* streamFoxyResponse(
  userMessage: string,
  userContext?: UserContext
): AsyncGenerator<string> {
  let systemPrompt = FOXY_SYSTEM_PROMPT;
  
  if (userContext) {
    systemPrompt += `\n\nUser context: Level ${userContext.level || 1}, Portfolio $${userContext.portfolioUsd || 0}`;
  }
  
  try {
    const stream = await heuristClient.chat.completions.create({
      model: DEFAULT_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 250,
      temperature: 0.8,
      stream: true,
    });
    
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield content;
      }
    }
  } catch (error) {
    log.error('AI', 'Streaming error', error);
    throw new Error('Failed to stream AI response');
  }
}

export const aiService = {
  generateResponse: generateFoxyResponse,
  streamResponse: streamFoxyResponse,
};
