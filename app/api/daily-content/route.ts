import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const API_NINJA_KEY = process.env.API_NINJA_KEY || 'BJhCBg4lMPIrYg3zFlmkXtxQprr1cisx3lGCcSh6';
const CACHE_HOURS = 24;

// Fallback quotes if API fails
const FALLBACK_QUOTES = [
  { text: "The only way to do great work is to love what you do.", author: "Steve Jobs", category: "inspirational" },
  { text: "Success is not final, failure is not fatal: it is the courage to continue that counts.", author: "Winston Churchill", category: "motivational" },
  { text: "The best time to plant a tree was 20 years ago. The second best time is now.", author: "Chinese Proverb", category: "wisdom" },
  { text: "Your time is limited, don't waste it living someone else's life.", author: "Steve Jobs", category: "inspirational" },
  { text: "The only impossible journey is the one you never begin.", author: "Tony Robbins", category: "motivational" },
  { text: "It does not matter how slowly you go as long as you do not stop.", author: "Confucius", category: "wisdom" },
  { text: "Everything you've ever wanted is on the other side of fear.", author: "George Addair", category: "courage" },
  { text: "Hardships often prepare ordinary people for an extraordinary destiny.", author: "C.S. Lewis", category: "inspirational" },
  { text: "Believe you can and you're halfway there.", author: "Theodore Roosevelt", category: "confidence" },
  { text: "The future belongs to those who believe in the beauty of their dreams.", author: "Eleanor Roosevelt", category: "dreams" },
];

// Fallback riddles if API fails
const FALLBACK_RIDDLES = [
  { question: "I have cities, but no houses. I have mountains, but no trees. I have water, but no fish. What am I?", answer: "A map", difficulty: "easy" },
  { question: "What has keys but no locks, space but no room, and you can enter but not go in?", answer: "A keyboard", difficulty: "easy" },
  { question: "I speak without a mouth and hear without ears. I have no body, but I come alive with wind. What am I?", answer: "An echo", difficulty: "medium" },
  { question: "The more you take, the more you leave behind. What am I?", answer: "Footsteps", difficulty: "easy" },
  { question: "I have branches, but no fruit, trunk, or leaves. What am I?", answer: "A bank", difficulty: "medium" },
  { question: "What can travel around the world while staying in a corner?", answer: "A stamp", difficulty: "medium" },
  { question: "I am not alive, but I grow; I don't have lungs, but I need air; I don't have a mouth, but water kills me. What am I?", answer: "Fire", difficulty: "medium" },
];

interface QuoteData {
  text: string;
  author: string;
  category: string;
  source: 'api_ninja' | 'fallback';
}

interface RiddleData {
  question: string;
  answer: string;
  difficulty: string;
  source: 'api_ninja' | 'fallback';
}

function getQuoteForToday(): QuoteData {
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / (1000 * 60 * 60 * 24));
  const quote = FALLBACK_QUOTES[dayOfYear % FALLBACK_QUOTES.length];
  return { ...quote, source: 'fallback' };
}

function getRiddleForToday(): RiddleData {
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / (1000 * 60 * 60 * 24));
  const riddle = FALLBACK_RIDDLES[dayOfYear % FALLBACK_RIDDLES.length];
  return { ...riddle, source: 'fallback' };
}

async function fetchQuoteFromAPI(): Promise<QuoteData | null> {
  try {
    const response = await fetch('https://api.api-ninjas.com/v1/quotes?category=inspirational', {
      headers: { 'X-Api-Key': API_NINJA_KEY },
      next: { revalidate: 0 },
    });
    
    if (!response.ok) {
      console.log('[DailyContent] Quote API failed:', response.status);
      return null;
    }
    
    const data = await response.json();
    if (Array.isArray(data) && data.length > 0) {
      return {
        text: data[0].quote,
        author: data[0].author,
        category: data[0].category || 'inspirational',
        source: 'api_ninja',
      };
    }
    return null;
  } catch (error) {
    console.error('[DailyContent] Error fetching quote:', error);
    return null;
  }
}

async function fetchRiddleFromAPI(): Promise<RiddleData | null> {
  try {
    const response = await fetch('https://api.api-ninjas.com/v1/riddles', {
      headers: { 'X-Api-Key': API_NINJA_KEY },
      next: { revalidate: 0 },
    });
    
    if (!response.ok) {
      console.log('[DailyContent] Riddle API failed:', response.status);
      return null;
    }
    
    const data = await response.json();
    if (Array.isArray(data) && data.length > 0) {
      return {
        question: data[0].question,
        answer: data[0].answer,
        difficulty: 'medium', // API doesn't provide difficulty, default to medium
        source: 'api_ninja',
      };
    }
    return null;
  } catch (error) {
    console.error('[DailyContent] Error fetching riddle:', error);
    return null;
  }
}

/**
 * GET /api/daily-content
 * 
 * Returns cached daily quote and riddle.
 * Fetches from API Ninja if cache is expired/missing.
 * Falls back to hardcoded content if API fails.
 */
export async function GET(request: NextRequest) {
  console.log('[API] GET /api/daily-content');
  
  try {
    const supabase = createAdminClient();
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const expiresAt = new Date(Date.now() + CACHE_HOURS * 60 * 60 * 1000).toISOString();
    
    // Check cache for today's quote
    const { data: cachedQuote } = await supabase
      .from('daily_content_cache')
      .select('*')
      .eq('content_type', 'quote')
      .eq('cache_date', today)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    
    // Check cache for today's riddle
    const { data: cachedRiddle } = await supabase
      .from('daily_content_cache')
      .select('*')
      .eq('content_type', 'riddle')
      .eq('cache_date', today)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    
    let quote: QuoteData;
    let riddle: RiddleData;
    
    // Handle quote
    if (cachedQuote) {
      console.log('[DailyContent] Using cached quote');
      quote = {
        text: cachedQuote.quote_text,
        author: cachedQuote.quote_author,
        category: cachedQuote.quote_category,
        source: cachedQuote.source as 'api_ninja' | 'fallback',
      };
    } else {
      // Fetch from API or use fallback
      const apiQuote = await fetchQuoteFromAPI();
      quote = apiQuote || getQuoteForToday();
      
      // Cache the result
      const { error: cacheError } = await supabase
        .from('daily_content_cache')
        .upsert({
          content_type: 'quote',
          quote_text: quote.text,
          quote_author: quote.author,
          quote_category: quote.category,
          source: quote.source,
          cache_date: today,
          expires_at: expiresAt,
        }, {
          onConflict: 'content_type,cache_date',
        });
      
      if (cacheError) {
        console.error('[DailyContent] Failed to cache quote:', cacheError);
      }
    }
    
    // Handle riddle
    if (cachedRiddle) {
      console.log('[DailyContent] Using cached riddle');
      riddle = {
        question: cachedRiddle.riddle_question,
        answer: cachedRiddle.riddle_answer,
        difficulty: cachedRiddle.riddle_difficulty,
        source: cachedRiddle.source as 'api_ninja' | 'fallback',
      };
    } else {
      // Fetch from API or use fallback
      const apiRiddle = await fetchRiddleFromAPI();
      riddle = apiRiddle || getRiddleForToday();
      
      // Cache the result
      const { error: cacheError } = await supabase
        .from('daily_content_cache')
        .upsert({
          content_type: 'riddle',
          riddle_question: riddle.question,
          riddle_answer: riddle.answer,
          riddle_difficulty: riddle.difficulty,
          source: riddle.source,
          cache_date: today,
          expires_at: expiresAt,
        }, {
          onConflict: 'content_type,cache_date',
        });
      
      if (cacheError) {
        console.error('[DailyContent] Failed to cache riddle:', cacheError);
      }
    }
    
    return NextResponse.json({
      success: true,
      quote,
      riddle,
      cached_at: new Date().toISOString(),
      expires_at: expiresAt,
    });
    
  } catch (error) {
    console.error('[API] Error fetching daily content:', error);
    
    // Return fallback on any error
    return NextResponse.json({
      success: true,
      quote: getQuoteForToday(),
      riddle: getRiddleForToday(),
      fallback: true,
    });
  }
}
