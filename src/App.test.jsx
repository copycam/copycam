import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App.jsx';

describe('App', () => {
  it('renders the landing copy and the three steps', () => {
    render(<App />);
    // the logo: "Copy" alone also names the command's copy button
    expect(screen.getByText('Cam').parentElement).toHaveTextContent(/^CopyCam$/);
    expect(screen.getByText(/point your phone at any text/i)).toBeInTheDocument();
    expect(screen.getByText(/pair once — scan the qr/i)).toBeInTheDocument();
    expect(screen.getByText(/frame the text and tap/i)).toBeInTheDocument();
    expect(screen.getByText(/on your pc's clipboard/i)).toBeInTheDocument();
  });

  it('renders the demo inside the device frame starting on the pair screen', () => {
    render(<App />);
    expect(screen.getByText('PAIR ONCE')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /simulate desktop scan/i })).toBeInTheDocument();
  });

  it('tells a visitor how to get it, and links to the code and the help', () => {
    render(<App />);
    expect(screen.getByRole('link', { name: /get copycam/i })).toHaveAttribute('href', '#get');
    expect(screen.getByRole('heading', { name: 'Get CopyCam' }).closest('section')).toHaveAttribute('id', 'get');
    expect(screen.getByText('npx copycam')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(screen.getByText('No ads. Not a single one.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'GitHub' })).toHaveAttribute('href', 'https://github.com/copycam/copycam');
    expect(screen.getByRole('link', { name: 'Troubleshooting' }).getAttribute('href').endsWith('docs/troubleshooting.md')).toBe(true);
  });
});
