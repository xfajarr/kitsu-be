import { Hono } from 'hono';
import { db } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { jwtService } from '../lib/jwt';
import { generateFoxyResponse } from '../services/ai';
import { log } from '../lib/logger';
import { z } from 'zod';
import { validateBody } from '../middleware/validate';

export const aiRoutes = new Hono();

const chatSchema = z.object({
  message: z.string().min(1).max(2000),
  context: z.object({
    portfolioUsd: z.number().optional(),
    goalsCount: z.number().optional(),
    densCount: z.number().optional(),
    level: z.number().optional(),
  }).optional(),
});

// POST /ai/chat - Chat with Foxy AI
aiRoutes.post('/chat', validateBody(chatSchema), async (c) => {
  const { message, context } = c.get('validatedBody') as z.infer<typeof chatSchema>;
  
  // Try to get user context from auth token
  const authHeader = c.req.header('Authorization');
  let userContext = context;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const payload = await jwtService.verifyToken(token);
    
    if (payload) {
      const user = await db.query.users.findFirst({
        where: eq(users.id, payload.userId),
      });
      
      if (user && !userContext) {
        userContext = {
          level: user.level,
        };
      }
    }
  }
  
  try {
    log.ai('Processing chat request', { message: message.slice(0, 50) });
    
    const reply = await generateFoxyResponse(message, userContext);
    
    return c.json({
      success: true,
      data: { reply },
    });
  } catch (error) {
    log.error('AI', 'Chat processing failed', error);
    
    // Fallback response
    const fallbackReply = "Sorry, I'm having trouble connecting right now. Please try again in a moment! 🦊";
    
    return c.json({
      success: true,
      data: { reply: fallbackReply },
    });
  }
});
