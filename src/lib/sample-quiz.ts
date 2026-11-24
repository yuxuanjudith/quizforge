/**
 * A fixed quiz for trying the game without spending an AI call — also what
 * the two-browser test plays, since its answers are known in advance.
 */

import type { DraftQuestion } from './quiz-logic'

export const SAMPLE_TITLE = 'Sample: how a web page reaches you'

export const SAMPLE_QUESTIONS: DraftQuestion[] = [
  {
    prompt: 'What does DNS do when you type a site name into the browser?',
    options: ['Encrypts the page', 'Turns the name into an IP address', 'Caches images', 'Picks the fastest Wi-Fi'],
    answerIndex: 1,
    explanation: 'DNS is the internet’s phone book: it maps names like example.com to the IP address of a server.',
  },
  {
    prompt: 'Which part of HTTPS keeps people on the same Wi-Fi from reading your traffic?',
    options: ['Cookies', 'The URL path', 'TLS encryption', 'The HTTP method'],
    answerIndex: 2,
    explanation: 'TLS encrypts the connection between your browser and the server.',
  },
  {
    prompt: 'A server answers with status 404. What happened?',
    options: ['The page was not found', 'The server crashed', 'You must sign in', 'The request succeeded'],
    answerIndex: 0,
    explanation: '404 means the server is up but has nothing at that address. 5xx codes are server errors.',
  },
  {
    prompt: 'Why do sites use a CDN?',
    options: ['To store passwords', 'To serve files from servers close to the visitor', 'To write the HTML', 'To replace DNS'],
    answerIndex: 1,
    explanation: 'A content delivery network keeps copies near users, so pages load faster.',
  },
  {
    prompt: 'What runs JavaScript in a web page?',
    options: ['The DNS resolver', 'The web server only', 'The router', 'The browser'],
    answerIndex: 3,
    explanation: 'Front-end JavaScript is downloaded and executed by the browser itself.',
  },
]
