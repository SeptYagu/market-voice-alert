const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

export function getProxyRoutes(env = process.env) {
  const eastmoneyHeaders = {
    referer: 'https://quote.eastmoney.com/',
    'user-agent': `${DEFAULT_USER_AGENT} Chrome/120.0.0.0 Safari/537.36`,
    accept: '*/*'
  };
  return [
    { prefix: '/api/eastmoney-kline', target: 'https://push2his.eastmoney.com', upstreamPrefix: '/api', headers: eastmoneyHeaders },
    { prefix: '/api/limit-up-stock', target: 'https://push2.eastmoney.com', upstreamPrefix: '/api', headers: eastmoneyHeaders },
    { prefix: '/api/qq-kline-min', target: 'https://ifzq.gtimg.cn', upstreamPrefix: '', headers: { referer: 'https://gu.qq.com/', 'user-agent': DEFAULT_USER_AGENT } },
    { prefix: '/api/eastmoney', target: 'https://push2.eastmoney.com', upstreamPrefix: '/api', headers: eastmoneyHeaders },
    { prefix: '/api/limit-up', target: 'https://push2.eastmoney.com', upstreamPrefix: '/api', headers: eastmoneyHeaders },
    { prefix: '/api/qq-kline', target: 'https://web.ifzq.gtimg.cn', upstreamPrefix: '', headers: { referer: 'https://gu.qq.com/', 'user-agent': DEFAULT_USER_AGENT } },
    { prefix: '/api/aktools', target: env.AKTOOLS_BASE || 'http://127.0.0.1:8888', upstreamPrefix: '', headers: {} },
    { prefix: '/api/tencent', target: 'https://qt.gtimg.cn', upstreamPrefix: '', headers: { 'user-agent': DEFAULT_USER_AGENT } },
    { prefix: '/api/sina', target: 'https://hq.sinajs.cn', upstreamPrefix: '', headers: { referer: 'https://finance.sina.com.cn/', 'user-agent': DEFAULT_USER_AGENT } }
  ];
}

export function resolveProxyTarget(pathname, search = '', env = process.env) {
  const route = getProxyRoutes(env).find(({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  if (!route) return null;
  const suffix = pathname.slice(route.prefix.length);
  const upstreamPath = `${route.upstreamPrefix}${suffix}` || '/';
  return {
    ...route,
    url: new URL(`${upstreamPath}${search}`, route.target).toString()
  };
}
