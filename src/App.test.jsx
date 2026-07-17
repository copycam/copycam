import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App.jsx';

describe('App', () => {
  it('renders the landing copy and the three steps', () => {
    render(<App />);
    expect(screen.getByText('Copy')).toBeInTheDocument();
    expect(screen.getByText('Cam')).toBeInTheDocument();
    expect(screen.getByText(/point your phone at any text/i)).toBeInTheDocument();
    expect(screen.getByText(/pair once — scan the qr/i)).toBeInTheDocument();
    expect(screen.getByText(/tap the shutter/i)).toBeInTheDocument();
    expect(screen.getByText(/pasted-ready on the pc/i)).toBeInTheDocument();
  });

  it('renders the demo inside the device frame starting on the pair screen', () => {
    render(<App />);
    expect(screen.getByText('PAIR ONCE')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /simulate desktop scan/i })).toBeInTheDocument();
  });
});
