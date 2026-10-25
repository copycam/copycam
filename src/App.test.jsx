import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import App from './App.jsx';

describe('App', () => {
  it('renders the landing copy and the three steps', () => {
    render(<App />);
    // the logo: "Copy" alone also names the command's copy button
    expect(screen.getByText('Cam').parentElement).toHaveTextContent(/^CopyCam$/);
    expect(screen.getByText(/point your phone at any text/i)).toBeInTheDocument();
    expect(screen.getByText(/open copycam.app on your computer, and scan its code once/i)).toBeInTheDocument();
    expect(screen.getByText(/frame the text and tap/i)).toBeInTheDocument();
    expect(screen.getByText(/send — it's on your computer's clipboard/i)).toBeInTheDocument();
  });

  it('renders the demo inside the device frame starting on the pair screen', () => {
    render(<App />);
    expect(screen.getByText('PAIR ONCE')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /point at the qr code/i })).toBeInTheDocument();
  });

  it('tells a visitor how to get it, and links to the code and the help', () => {
    render(<App />);
    // the web version is the way in; the companion is the alternative
    expect(screen.getByRole('link', { name: /start copycam/i })).toHaveAttribute('href', '/app/');
    expect(screen.getByRole('link', { name: /open copycam\.app\/app/i })).toHaveAttribute('href', '/app/');
    expect(screen.getByRole('heading', { name: 'Get CopyCam' }).closest('section')).toHaveAttribute('id', 'get');
    // look inside the Get CopyCam section
    const get = screen.getByRole('heading', { name: 'Get CopyCam' }).closest('section');
    expect(within(get).getByText('npx copycam')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(screen.getByText('No ads. Not a single one.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy/');
    expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms/');
    expect(screen.getByRole('link', { name: 'Licences' })).toHaveAttribute('href', '/licenses/');
    expect(screen.getByRole('link', { name: 'Accessibility' })).toHaveAttribute('href', '/accessibility/');
    expect(screen.getByRole('link', { name: 'הצהרת נגישות' })).toHaveAttribute('href', '/he/accessibility/');
    // the logo is the page's one top-level heading
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^CopyCam$/);
    expect(screen.getByRole('link', { name: 'GitHub' })).toHaveAttribute('href', 'https://github.com/copycam/copycam');
    expect(screen.getByRole('link', { name: 'Troubleshooting' }).getAttribute('href').endsWith('docs/troubleshooting.md')).toBe(true);
  });

  it('presents the two ways to connect as things you get, not a choice', () => {
    render(<App />);
    expect(screen.getByText('Two ways to connect, both included')).toBeInTheDocument();
    expect(screen.getByText('DIRECT ON YOUR WI‑FI')).toBeInTheDocument();
    expect(screen.getByText('THROUGH COPYCAM.APP')).toBeInTheDocument();
    expect(screen.getByText(/picks the way by itself/)).toBeInTheDocument();
  });
});
