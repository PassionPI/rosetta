type Body = object | RequestInit["body"];

type Prime = string | number | boolean | null | undefined;

type BasePayload<Options extends object = object> = {
  options?: Partial<Options>;
};

type BaseResponse = object | Prime | void;

type Payload<Options extends object = object> = BasePayload<Options> &
  Omit<RequestInit, "body"> & {
    /** input */
    url: string;
    search?:
      | ConstructorParameters<typeof URLSearchParams>[0]
      | Record<string, Prime | Array<Prime>>;
    /** request init */
    body?: Body;
  };

type Context<Options extends object = object> = BasePayload<Options> &
  Omit<RequestInit, "body" | "headers"> & {
    /** input */
    url: URL;
    /** request init */
    body?: Body;
    headers: Headers;
  };

type Result<R, Options extends object = object> = Promise<
  | [
      error: Error,
      value: null,
      meta: {
        context: Context<Options>;
        response: Response | null;
      },
    ]
  | [
      error: null,
      value: R,
      meta: {
        context: Context<Options>;
        response: Response;
      },
    ]
>;

export type ResultWithAbort<R, Options extends object = object> = Result<
  R,
  Options
> & {
  abort: () => void;
  unwrap: () => Promise<R>;
};

type Unit<T, R> = (ctx: T, next: () => Promise<R>) => Promise<R> | R;

type Middleware<Options extends object = object> = Unit<
  Context<Options>,
  Result<BaseResponse, Options>
>;

const contentType = (headers: Headers) => String(headers.get("Content-Type"));

const typeJSON = (headers: Headers) =>
  contentType(headers).includes("application/json");

const typeText = (headers: Headers) =>
  contentType(headers).includes("text/plain");

const parseBody = ({ body, headers }: Context) => {
  if (body === null || body === undefined) {
    return;
  }

  if (typeJSON(headers) && typeof body === "object") {
    return JSON.stringify(body);
  }

  return body as BodyInit;
};

const parseContent = (response: Response) => {
  const { headers } = response;

  if (typeJSON(headers)) {
    return response.json();
  }

  if (typeText(headers)) {
    // response.clone().text() 这里只有当后端返回无法解析为文本的时候, 才会报错
    // 例如二进制文件, 无效的 UTF-8 字符序列
    return response.text();
  }

  return Promise.resolve();
};

const append = (search: URLSearchParams, key: string, val: Prime) => {
  if (val !== undefined) {
    search.append(key, String(val));
  }
};

const parseSearch = (
  search?: Payload["search"],
): ConstructorParameters<typeof URLSearchParams>[0] => {
  if (!search) {
    return "";
  }
  if (Array.isArray(search) || search instanceof URLSearchParams) {
    return search;
  }
  if (typeof search === "object") {
    return Object.entries(search).reduce((acc, [key, val]) => {
      if (Array.isArray(val)) {
        val.forEach((v) => append(acc, key, v));
      } else {
        append(acc, key, val);
      }
      return acc;
    }, new URLSearchParams());
  }
  return search;
};

const createContext = <Options extends object = object>({
  url,
  search,
  method,
  headers,
  ...rest
}: Payload<Options>): Context<Options> => {
  const input = new URL(url, globalThis.location?.origin);

  if (search) {
    input.search = new URLSearchParams(parseSearch(search)).toString();
  }

  return {
    url: input,
    method: (method ?? "GET").toUpperCase(),
    headers: new Headers(headers),
    ...rest,
  };
};

const once = <A extends unknown[], T>(fn: (...args: A) => T) => {
  let done = false;
  let result: T;
  return (...args: A) => {
    if (!done) {
      done = true;
      result = fn(...args);
    }
    return result;
  };
};

const onion = <Ctx, Resp>(
  fns: Unit<Ctx, Resp>[],
  end: (ctx: Ctx) => Promise<Awaited<Resp>>,
) => {
  const len = fns?.length ?? 0;
  return (ctx: Ctx) => {
    const next = async (i: number): Promise<Awaited<Resp>> => {
      if (i < len) {
        return await fns[i](
          ctx,
          once(() => next(i + 1)),
        );
      }
      return await end(ctx);
    };
    return next(0);
  };
};

const baseFetch = async <
  R extends BaseResponse,
  Options extends object = object,
>(
  context: Context<Options>,
): Result<R> => {
  const { url, body, ...init } = context ?? {};

  const request = new Request(url, {
    ...init,
    body: parseBody(context),
  });

  // 这里是网络错误或者请求被阻止(CORS), 才会出现 error
  // 只要后端返回了, 不管 http status 是多少, 都不会报错
  const [err, response] = await fetch(request).then(
    (val) => [null, val] as [null, Response],
    (err) => [err, null] as [Error, null],
  );

  if (err) {
    return [err, null, { context, response }];
  }

  const meta = { context, response };

  if (response.ok) {
    const content = parseContent(response);

    const [error, value] = await content.then(
      (val) => [null, val] as [null, R],
      (err) => [err, null] as [Error, null],
    );

    if (error) {
      return [error, null, meta];
    }

    return [null, value, meta];
  }

  return [new ApiError(response.status, ``), null, meta];
};

const error: Middleware = (context, next) =>
  next().then(
    (result) => result,
    (e) =>
      [Error(e as string), null, { context, response: null }] as [
        Error,
        null,
        { context: Context; response: Response | null },
      ],
  );

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const createFetch = <Options extends object = object>(
  ...middlewares: Middleware<Options>[]
) => {
  return <R extends BaseResponse>(
    payload: Payload<Options>,
  ): ResultWithAbort<R, Options> => {
    const controller = new AbortController();
    const middleware = [error, ...middlewares];
    const responding = onion(middleware, (context) =>
      baseFetch<R>({ ...context, signal: controller.signal }),
    )(createContext(payload)) as ResultWithAbort<R, Options>;
    responding.abort = () => controller.abort();
    responding.unwrap = () =>
      responding.then(([error, value]) =>
        error ? Promise.reject(error) : value,
      );
    return responding;
  };
};
