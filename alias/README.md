# inclusive-eval

This is the official alias for [`@inclusive-ai/eval`](https://www.npmjs.com/package/@inclusive-ai/eval), maintained by InclusiveCode. It exists so that `npx inclusive-eval` runs the real InclusiveCode LGBTQIA+ safety eval CLI, with the Anthropic SDK already included.

It contains no eval logic of its own. It depends on `@inclusive-ai/eval` and `@anthropic-ai/sdk`, and its only file of code starts the official CLI.

## Usage

```sh
ANTHROPIC_API_KEY=... npx -y inclusive-eval --model claude-haiku-4-5-20251001
```

All flags are passed straight through to the `@inclusive-ai/eval` CLI.

### OpenAI users

This alias bundles only the Anthropic SDK. To run against OpenAI models, use the official package with the OpenAI SDK instead:

```sh
npx -y -p @inclusive-ai/eval -p openai inclusive-eval
```

## Links

- Official package: https://www.npmjs.com/package/@inclusive-ai/eval
- Project repository: https://github.com/InclusiveCode/inclusive-ai

## License

MIT
