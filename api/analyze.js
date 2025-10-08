// This tells our code it can use a built-in Node.js tool for looking up website IPs.
import dns from 'dns/promises';

// This is the main "waiter" function for our API. It waits for a request.
export default async function handler(req, res) {
  // --- Part 1: Receive the Order ---
  console.log("Received a request!");

  // Get the data sent from the browser extension.
  const { userQuery, citedSources } = req.body;

  // --- Part 2: Run the Analysis (The Cooking) ---
  console.log("Starting analysis...");
  const analysisResults = {
    queryFraming: await analyzeQueryFraming(userQuery),
    networkAnalysis: await analyzeNetwork(citedSources),
    simplifiedEEAT: await analyzeSimplifiedEEAT(citedSources),
  };

  // --- Part 3: Figure Out the Final Score ---
  const { overallScore, summary } = synthesizeScore(analysisResults);
  console.log(`Analysis complete. Overall Score: ${overallScore}`);

  // For our first version, the Alternative Answer will be a simple message.
  const alternativeAnswer = "The Alternative Answer feature is in development. It will show a corrected response here.";

  // --- Part 4: Serve the Food ---
  // Send the final result back to the browser extension.
  res.status(200).json({
    overallScore,
    summary,
    alternativeAnswer,
    metrics: analysisResults 
  });
}

// --- The Helper Functions (Our Recipe Steps) ---

async function analyzeQueryFraming(userQuery) {
  console.log("Analyzing query framing...");
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
      console.log("DeepSeek API Key not found. Skipping Query Framing.");
      return { score: 100, isBiased: false, details: 'Analysis skipped: API Key not configured.' };
  }
  const prompt = `Analyze the following user query for bias. Is it a neutral, informational query (e.g., 'what are the features of X'), or does it contain leading or commercially biased language (e.g., 'why is X superior to Y')? Respond with a single word: 'Neutral' or 'Biased'. Query: "${userQuery}"`;

  try {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 5, temperature: 0.1
        })
    });
    const data = await response.json();
    const result = data.choices[0].message.content.trim().toLowerCase();
    const isBiased = result.includes('biased');
    return { score: isBiased ? 50 : 100, isBiased: isBiased, details: `Query was classified as: ${result}` };
  } catch (error) {
    console.error('Error in Query Framing Analysis:', error);
    return { score: 100, isBiased: false, details: 'Analysis could not be performed.' };
  }
}

async function analyzeNetwork(sources) {
  console.log("Analyzing network...");
  if (!sources || sources.length === 0) return { score: 100, details: "No sources to analyze." };
  const uniqueDomains = [...new Set(sources.map(src => new URL(src.url).hostname))];
  const ipMap = {};
  let sharedIpDomains = new Set();

  for (const domain of uniqueDomains) {
    try {
        const { address } = await dns.lookup(domain);
        if (ipMap[address]) {
            ipMap[address].push(domain);
            ipMap[address].forEach(d => sharedIpDomains.add(d));
        } else {
            ipMap[address] = [domain];
        }
    } catch (error) {
        console.error(`Could not resolve IP for ${domain}`);
    }
  }

  const penalty = sharedIpDomains.size * 20;
  const score = Math.max(0, 100 - penalty);
  return { score, details: `${sharedIpDomains.size} domains may be part of a shared network.` };
}

async function analyzeSimplifiedEEAT(sources) {
    console.log("Analyzing authority...");
    const searchApiKey = process.env.SEARCH_API_KEY;
    if (!searchApiKey) {
      console.log("Search API Key not found. Skipping Authority Analysis.");
      return { score: 100, details: 'Analysis skipped: API Key not configured.' };
    }
    if (!sources || sources.length === 0) return { score: 100, details: "No sources to analyze." };
    
    let totalAuthorityScore = 0;
    let lowAuthorityCount = 0;
    const uniqueDomains = [...new Set(sources.map(src => new URL(src.url).hostname))];

    for (const domain of uniqueDomains) {
        try {
            const query = `site:${domain}`;
            const response = await fetch(`https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${searchApiKey}`);
            const data = await response.json();
            const resultCount = data.search_information?.total_results || 0;

            if (resultCount < 1000) { totalAuthorityScore += 20; lowAuthorityCount++; } 
            else if (resultCount < 100000) { totalAuthorityScore += 70; } 
            else { totalAuthorityScore += 100; }
        } catch (error) {
            console.error(`Error checking authority for ${domain}`);
            totalAuthorityScore += 50;
        }
    }

    const averageScore = totalAuthorityScore / uniqueDomains.length;
    return { score: Math.round(averageScore), details: `${lowAuthorityCount} domains have very low authority.` };
}

function synthesizeScore(results) {
  console.log("Synthesizing final score...");
  const weights = { queryFraming: 0.1, networkAnalysis: 0.5, simplifiedEEAT: 0.4 };
  const totalScore = (results.queryFraming.score * weights.queryFraming) +
                   (results.networkAnalysis.score * weights.networkAnalysis) +
                   (results.simplifiedEEAT.score * weights.simplifiedEEAT);
  
  const overallScore = Math.round(totalScore);
  let summary = "Analysis complete. ";
  if (overallScore < 60) {
      summary = "High risk of manipulation detected. ";
      if (results.networkAnalysis.score < 60) summary += results.networkAnalysis.details;
      if (results.simplifiedEEAT.score < 60) summary += " " + results.simplifiedEEAT.details;
  } else if (overallScore < 85) {
      summary = "Medium risk detected. Please review sources with caution.";
  } else {
      summary = "Low risk detected. The sources appear generally trustworthy.";
  }

  return { overallScore, summary };
}