(function(){
  const legacyOrders=window.orders;
  const legacyMonitoring=window.monitoring;
  const legacySystemHealth=window.systemHealthView;

  const ROLE_LABELS={ops_admin:'运营管理员',account_manager:'客户经理',commercial_manager:'商务负责人',geo_lead:'GEO 负责人',qa_reviewer:'质量审核',delivery_operator:'交付运营',viewer:'只读成员'};
  const STATUS_LABELS={
    available:'正常',not_configured:'未配置',pending_review:'待审核',approved:'已审核',active:'进行中',completed:'已完成',released:'已交付',
    draft:'草稿',blocked:'已阻塞',failed:'失败',rejected:'未通过',changes_requested:'需修改',ready_for_capture:'待检测',capture_in_progress:'检测中',
    captured:'检测完成',partial_capture:'部分完成',waiting_for_human:'等待人工处理',queued:'排队中',onboarding:'资料建档中',INTAKE:'待接收',ONBOARDING:'资料建档中',DETECTION:'检测中',DIAGNOSIS:'诊断中',SOLUTION:'方案中',REVIEW:'审核中',RELEASED:'已交付',MONITORING:'持续服务',BLOCKED:'已阻塞'
  };
  const TYPE_LABELS={
    customer_attachment:'客户提交资料',client:'客户档案',project:'项目档案',entity_profile:'品牌基础信息',brand_identity_anchor:'品牌识别信息',
    customer_intelligence_profile:'品牌企业完整画像',persona_graph:'Persona（画像子模块）',journey_graph:'客户决策旅程（画像子模块）',brand_persona_fit:'品牌与目标客群匹配',industry_pack_reference:'行业知识模板',
    query_signal:'关键词与需求信号',query_scenario:'客户问题场景',query_family:'问题主题',query:'检测问题',query_set:'检测问题集',query_quality_review:'问题审核记录',prompt_template:'测试问题模板',prompt_instance:'平台测试问题',platform_test_plan:'AI 平台检测方案',observation_batch:'检测批次',
    platform_test_run:'平台检测任务',raw_answer:'AI 原始回答',parsed_answer:'AI 回答解析',source_snapshot:'来源记录',citation:'回答引用',evaluation:'诊断评估',score_snapshot:'评分结果',root_cause:'问题根因',root_cause_finding:'问题根因',opportunity:'优化机会',recommended_action:'优化建议',solution_package:'优化解决方案',commercial_handoff:'客户交接记录',service_order:'服务确认记录',optimization_plan:'优化实施计划',action:'实施任务',action_execution_record:'实施操作记录',action_evidence:'实施证据',action_acceptance_review:'实施验收',retest_plan:'复测计划',retest_run:'复测任务',retest_comparison:'复测对比',outcome_assessment:'效果评估',closure_decision:'阶段结论',report:'客户报告',report_delivery_record:'报告交付记录',delivery_package:'客户交付包',monitoring_subscription:'持续监测计划',manual_intervention_task:'人工待办与异常',workflow_definition:'流程模板',workflow_instance:'流程记录'
  };
  const STAGE_SPECS=[
    ['foundation','品牌企业资料与研究',['customer_intelligence_profile']],
    ['planning','检测策略与问题库',['query_set','platform_test_plan','observation_batch']],
    ['detection','五平台 AI 检测',['raw_answer','platform_test_run']],
    ['diagnosis','GEO 诊断与竞争情报',['score_snapshot']],
    ['optimization','客户专属 GEO 优化方案',['solution_package']],
    ['implementation','优化实施与验收',['optimization_plan','action']],
    ['retest','效果复测',['retest_comparison','outcome_assessment']],
    ['delivery_monitoring','报告交付与持续优化',['diagnostic_report_release','monitoring_subscription']]
  ];
  let workspaceTab='profile';

  function recordsOf(d,type){return d?.records?.[type]||[]}
  function latest(rows){return [...(rows||[])].sort((a,b)=>String(b.updated_at||b.created_at||'').localeCompare(String(a.updated_at||a.created_at||'')))[0]||null}
  function text(v,fallback='—'){return v===undefined||v===null||v===''?fallback:String(v)}
  function roleLabel(v){return ROLE_LABELS[v]||'运营成员'}
  function statusLabel(v){return STATUS_LABELS[String(v||'')]||String(v||'未知')}
  function statusClass(v){const s=String(v||'').toLowerCase();if(/completed|approved|active|available|released|captured|ready|success|confirmed/.test(s))return'ok';if(/blocked|failed|rejected|error/.test(s))return'danger';return'warn'}
  function chip(v){return `<span class="status-chip ${statusClass(v)}">${esc(statusLabel(v))}</span>`}
  function businessStage(d){
    const pipeline=d?.geo_pipeline;
    if(pipeline?.stages?.length){
      const rows=pipeline.stages.map(x=>({key:x.stage_key,label:x.label,done:x.complete,state:x.state}));
      let current=rows.findIndex(x=>x.key===pipeline.current_stage_key);
      if(current<0)current=Math.max(0,rows.findIndex(x=>!x.done));
      if(current<0)current=rows.length-1;
      return {
        rows,current,
        label:pipeline.current_stage_label||rows[current]?.label||'品牌企业资料与研究',
        progress:Number(pipeline.progress_percent||0)
      };
    }
    const records=d?.records||{};let current=STAGE_SPECS.length-1;const rows=[];
    STAGE_SPECS.forEach((spec,index)=>{
      const [key,label,required]=spec;const matching=required.filter(t=>(records[t]||[]).length>0);const done=matching.length>0;rows.push({key,label,done});if(!done&&current===STAGE_SPECS.length-1)current=index;
    });
    const completed=rows.filter(x=>x.done).length;return {rows,current,label:rows[current]?.label||'客户资料接收',progress:Math.round(completed/rows.length*100)};
  }
  function projectIdFor(d){const record=latest(recordsOf(d,'project'));return record?.project_id||d?.projects?.[0]?.project_id||''}
  function canonicalClientId(d){const c=d?.client||{};return c.canonical_client_id||c.client_id||''}
  function displayName(d){return d?.client?.display_name||latest(recordsOf(d,'customer_attachment'))?.business_profile?.brandName||canonicalClientId(d)}
  function pendingReviews(d){let n=0;Object.values(d?.records||{}).forEach(rows=>(rows||[]).forEach(r=>{if(['pending_review','changes_requested'].includes(String(r.review_status||'')))n++}));return n}
  function blockingCount(d){return recordsOf(d,'manual_intervention_task').filter(r=>!['resolved','completed','approved','rejected'].includes(String(r.status||''))&&r.blocking!==false).length}
  function openTaskCount(d){return recordsOf(d,'manual_intervention_task').filter(r=>!['resolved','completed','approved','rejected'].includes(String(r.status||''))).length}
  function pendingActionCount(d){return pendingReviews(d)+openTaskCount(d)}
  function dataCount(d){return Object.values(d?.records||{}).reduce((n,rows)=>n+(rows||[]).length,0)}
  function customerContactDisplay(value){
    const raw=String(value||'').trim();
    if(!raw)return '历史记录未关联手机号';
    if(/小程序客户.*未绑定手机号|未绑定手机号|手机号未绑定|联系方式待同步/i.test(raw))return '历史记录未关联手机号';
    return raw;
  }
  function formatDate(v){if(!v)return'—';const d=new Date(v);if(Number.isNaN(d.getTime()))return text(v);return d.toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})}
  function short(v,n=110){const s=String(v||'');return s.length>n?s.slice(0,n)+'…':s}
  function visibleSummary(row){
    for(const key of ['query_text','rendered_user_prompt','summary','finding','description','action_title','title','report_title','project_name','persona_name','journey_name','core_decision_task','stage_goal','raw_text','answer_text','content']){
      if(row&&row[key])return short(row[key]);
    }
    return TYPE_LABELS[row?.object_type]||'数据记录';
  }
  function setBusinessTitle(title,subtitle){setTitle(title,'运营管理',subtitle)}
  function kpi(label,value,sub){return `<div class="biz-kpi"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(sub)}</small></div>`}
  function emptyBiz(message){return `<div class="notice">${esc(message)}</div>`}

  window.render=async function(){
    document.body.classList.add('ops-business');
    const coreViews=new Set([
      'dashboard','clients','intakes','client','miniprogram-users',
      'channel-overview','channel-manage','channel-statistics',
      'data-center','data-center-customers','data-center-business','data-center-payments',
      'ai-platform-daily','geo-competitive-daily','competitive-intelligence'
    ]);
    if(!coreViews.has(state.view)){state.view='dashboard';state.client=null}
    window.syncNavigationState?.();
    if(state.view==='dashboard')return businessDashboard();
    if(state.view==='intakes')return businessIntakes();
    if(state.view==='clients')return businessClients();
    if(state.view==='miniprogram-users')return miniProgramUsers();
    if(state.view==='client')return businessClientWorkspace(state.client);
    if(state.view==='data-center')return dataCenter();
    if(state.view==='data-center-customers')return customerStatistics();
    if(state.view==='data-center-business')return businessStatistics();
    if(state.view==='channel-overview')return channelOverview();
    if(state.view==='channel-manage')return channelManagement();
    if(state.view==='channel-statistics')return channelStatistics();
    if(state.view==='data-center-payments')return paymentStatistics();
    if(state.view==='ai-platform-daily')return dataCenterAIPlatform();
    if(state.view==='geo-competitive-daily')return dataCenterCompetitiveMonitoring();
    if(state.view==='competitive-intelligence')return dataCenterCompetitiveDatabase();
  };

  async function businessDashboard(){
    setBusinessTitle('工作台','查看今天需要推进的客户、待处理事项和交付进度。');
    const [overview,clientsData]=await Promise.all([api('/api/operations-overview'),api('/api/clients')]);
    const m=overview.metrics||{};const stageMax=Math.max(1,...(overview.stage_distribution||[]).map(x=>x.count||0));
    const dayMax=Math.max(1,...(overview.last_7_days||[]).map(x=>x.operation_count||0));
    const taskCount=m.pending_tasks||0;const nav=$('#navTaskCount');if(nav){nav.textContent=taskCount;nav.classList.toggle('hidden',!taskCount)}
    content.innerHTML=`
      <div class="biz-kpi-grid">${kpi('客户总数',m.total_clients||0,'已进入运营后台')}${kpi('进行中项目',m.total_projects||0,'全部客户项目')}${kpi('待接收客户',m.pending_intakes||0,'仅统计已付款或历史免支付')}${kpi('待办与异常',m.pending_tasks||0,'需要运营处理')}${kpi('待复核数据',m.pending_reviews||0,'需要人工确认')}${kpi('已交付报告',m.delivered_reports||0,'正式交付记录')}</div>
      <div style="height:14px"></div>
      <div class="biz-grid-2">
        <section class="biz-card"><div class="biz-card-head"><div><h3>近 7 天业务进展</h3><p>查看客户服务各阶段的实际推进情况</p></div></div><div class="biz-card-body"><div class="trend-bars">${(overview.last_7_days||[]).map(x=>`<div class="trend-col"><div class="trend-track"><i class="trend-fill" style="height:${Math.max(3,Math.round((x.operation_count||0)/dayMax*100))}%"></i></div><strong>${esc(String(x.date||'').slice(5))}</strong><span>${esc(x.operation_count||0)} 次</span></div>`).join('')}</div></div></section>
        <section class="biz-card"><div class="biz-card-head"><div><h3>今日运营日报</h3><p>${esc(overview.today_report?.date||'')}</p></div></div><div class="biz-card-body"><div class="daily-summary">${esc(overview.today_report?.summary||'今日暂无运营记录。')}</div><div style="height:10px"></div>${(overview.today_report?.events||[]).length?`<div class="record-groups">${(overview.today_report.events||[]).map(x=>`<div class="record-group"><div class="record-group-head"><strong>${esc(x.label)}</strong><span>${esc(x.count)} 次</span></div></div>`).join('')}</div>`:emptyBiz('今天还没有新的业务操作记录。')}</div></section>
      </div>
      <div style="height:14px"></div>
      <div class="biz-grid-2">
        <section class="biz-card"><div class="biz-card-head"><div><h3>客户所处阶段</h3><p>查看客户当前所处服务阶段</p></div><button class="secondary-action" onclick="go('clients')">进入客户管理</button></div><div class="biz-card-body"><div class="stage-bars">${(overview.stage_distribution||[]).map(x=>`<div class="stage-bar-row"><label>${esc(x.stage)}</label><div class="stage-bar-track"><i class="stage-bar-fill" style="width:${Math.round((x.count||0)/stageMax*100)}%"></i></div><strong>${esc(x.count||0)}</strong></div>`).join('')}</div></div></section>
        <section class="biz-card"><div class="biz-card-head"><div><h3>今天优先处理</h3><p>优先处理影响客户推进的事项</p></div></div><div class="biz-card-body"><div class="record-groups">${m.blocked_clients?`<div class="notice danger"><strong>${esc(m.blocked_clients)}  个客户存在待解决事项</strong><br>请进入对应客户工作区，在当前阶段处理后继续推进。</div>`:''}${m.pending_reviews?`<div class="notice warn"><strong>${esc(m.pending_reviews)} 条数据等待审核</strong><br>请进入对应客户，在当前阶段完成需要的人工确认。</div>`:''}${m.pending_intakes?`<div class="notice"><strong>${esc(m.pending_intakes)} 个客户待接收</strong><br>仅包含已付款客户和付款功能上线前的历史免支付客户；接收后进入品牌企业研究与诊断流程。</div>`:''}${!m.blocked_clients&&!m.pending_reviews&&!m.pending_intakes?emptyBiz('当前没有高优先级待处理事项。'):''}</div></div></section>
      </div>`;
  }

  function dataCenterTabs(){return ''}
  function prependDataCenterTabs(){
    const eyebrow=document.getElementById('pageEyebrow');if(eyebrow)eyebrow.textContent='数据中心';
  }
  async function dataCenter(){
    setBusinessTitle('数据中心','统一查看客户统计、业务运行、AI 平台变化和 GEO 行业竞品情报。');
    const overview=await api('/api/operations-overview');const m=overview.metrics||{};
    content.innerHTML=dataCenterTabs('data-center')+
      '<div class="biz-kpi-grid">'+
      kpi('客户总数',m.total_clients||0,'已建立客户档案')+
      kpi('进行中项目',m.total_projects||0,'客户服务项目')+
      kpi('待处理事项',m.pending_tasks||0,'人工待办与异常')+
      kpi('待复核数据',m.pending_reviews||0,'需要人工确认')+
      kpi('AI 检测回答',m.raw_ai_answers||0,'已采集平台回答')+
      kpi('已交付报告',m.delivered_reports||0,'客户已收到报告')+
      '</div><div style="height:14px"></div>'+
      '<div class="biz-grid-2">'+
      '<section class="biz-card"><div class="biz-card-head"><div><h3>客户与业务数据</h3><p>看客户规模、阶段分布和业务运行效率。</p></div></div><div class="biz-card-body"><div class="action-row"><button class="primary-action" onclick="go(\'data-center-customers\')">查看客户统计</button><button class="secondary-action" onclick="go(\'data-center-business\')">查看业务统计</button></div></div></section>'+
      '<section class="biz-card"><div class="biz-card-head"><div><h3>收款与渠道</h3><p>查看诊断订单收退款；渠道运营已独立到一级“渠道管理”。</p></div></div><div class="biz-card-body"><div class="action-row"><button class="secondary-action" onclick="go(\'data-center-payments\')">收款与退款</button><button class="primary-action" onclick="go(\'channel-overview\')">进入渠道总览</button></div></div></section>'+
      '<section class="biz-card"><div class="biz-card-head"><div><h3>外部环境情报</h3><p>跟踪 AI 平台策略与 GEO 行业竞争变化。</p></div></div><div class="biz-card-body"><div class="action-row"><button class="secondary-action" onclick="go(\'ai-platform-daily\')">AI 平台监测</button><button class="secondary-action" onclick="go(\'geo-competitive-daily\')">竞品监测</button><button class="secondary-action" onclick="go(\'competitive-intelligence\')">竞品数据库</button></div></div></section>'+
      '</div>';
  }
  async function customerStatistics(){
    setBusinessTitle('客户统计','查看客户规模、当前服务阶段和需要处理的客户状态。');
    const clients=(await api('/api/clients')).items||[];
    const workspaces=await Promise.all(clients.map(async c=>{try{return await api('/api/clients/'+encodeURIComponent(c.client_id))}catch{return {client:c,records:{},projects:[],timeline:[]}}}));
    const stages={};let blocked=0,pending=0;
    workspaces.forEach(d=>{const stage=businessStage(d);stages[stage.label]=(stages[stage.label]||0)+1;blocked+=blockingCount(d)>0?1:0;pending+=pendingActionCount(d)});
    const stageRows=Object.entries(stages).sort((a,b)=>b[1]-a[1]);
    const max=Math.max(1,...stageRows.map(([,n])=>n));
    content.innerHTML=dataCenterTabs('data-center-customers')+
      '<div class="biz-kpi-grid">'+kpi('全部客户',clients.length,'正式客户档案')+kpi('有阻塞事项',blocked,'存在真实 blocking 待办')+kpi('待处理事项',pending,'审核、异常与人工确认')+kpi('覆盖阶段',stageRows.length,'当前客户所处流程阶段')+'</div>'+
      '<div style="height:14px"></div><section class="biz-card"><div class="biz-card-head"><div><h3>客户阶段分布</h3><p>按每个客户当前 GEO 服务阶段统计。</p></div><button class="secondary-action" onclick="go(\'clients\')">进入客户管理</button></div><div class="biz-card-body"><div class="stage-bars">'+(stageRows.map(([label,count])=>'<div class="stage-bar-row"><label>'+esc(label)+'</label><div class="stage-bar-track"><i class="stage-bar-fill" style="width:'+Math.round(count/max*100)+'%"></i></div><strong>'+esc(count)+'</strong></div>').join('')||emptyBiz('当前还没有正式客户。'))+'</div></div></section>';
  }
  async function businessStatistics(){
    setBusinessTitle('业务统计','查看 GEO 服务流程的业务量、数据产出和近 7 天运行情况。');
    const overview=await api('/api/operations-overview');const m=overview.metrics||{};const max=Math.max(1,...(overview.data_distribution||[]).map(x=>x.count||0));
    content.innerHTML=dataCenterTabs('data-center-business')+
      '<div class="biz-kpi-grid">'+kpi('AI 原始回答',m.raw_ai_answers||0,'正式平台检测数据')+kpi('客户报告',m.reports||0,'已生成报告')+kpi('正式交付',m.delivered_reports||0,'客户已获得报告')+kpi('操作记录',m.timeline_events||0,'全流程审计留痕')+kpi('待办事项',m.pending_tasks||0,'需要运营处理')+kpi('待复核数据',m.pending_reviews||0,'需要人工确认')+'</div><div style="height:14px"></div><div class="biz-grid-2"><section class="biz-card"><div class="biz-card-head"><div><h3>业务数据构成</h3><p>按运营可理解的数据类型统计。</p></div></div><div class="biz-card-body"><div class="data-bars">'+(overview.data_distribution||[]).slice(0,24).map(x=>'<div class="data-row"><label>'+esc(x.label)+'</label><div class="data-track"><i class="data-fill" style="width:'+Math.round((x.count||0)/max*100)+'%"></i></div><strong>'+esc(x.count||0)+'</strong></div>').join('')+'</div></div></section><section class="biz-card"><div class="biz-card-head"><div><h3>近 7 天业务运行</h3><p>客户接入、方案准备、AI 检测和交付动作。</p></div></div><div class="biz-card-body"><table class="business-table"><thead><tr><th>日期</th><th>全部操作</th><th>客户接入</th><th>方案准备</th><th>AI 检测</th><th>交付</th></tr></thead><tbody>'+(overview.last_7_days||[]).map(x=>'<tr><td>'+esc(x.date)+'</td><td>'+esc(x.operation_count)+'</td><td>'+esc(x.customer_intake_count)+'</td><td>'+esc(x.planning_count)+'</td><td>'+esc(x.capture_count)+'</td><td>'+esc(x.delivery_count)+'</td></tr>').join('')+'</tbody></table></div></section></div>';
  }
  function paymentStatusLabel(status){
    return {
      unpaid:'待付款',paying:'付款确认中',paid:'已付款',payment_failed:'付款失败',closed:'已关闭',
      free:'已免付',refund_processing:'退款处理中',partially_refunded:'部分退款',refunded:'已退款',
      processing:'退款处理中',success:'退款成功',abnormal:'退款异常'
    }[String(status||'')]||String(status||'未知');
  }
  function moneyFen(value){return '¥'+(Number(value||0)/100).toFixed(2)}
  function paymentCloseReasonLabel(reason){
    return {
      expired:'超过 30 分钟未付款，自动关闭',
      customer_cancelled:'客户主动取消',
      provider_closed:'微信支付侧已关闭'
    }[String(reason||'')]||'—';
  }

  async function paymentStatistics(){
    setBusinessTitle('收款与退款','查看 199 元诊断报告订单、实收金额、微信支付交易信息和退款记录。');
    try{
      const data=await api('/api/payments'),s=data.summary||{},items=data.items||[],canRefund=Boolean(data.permissions&&data.permissions.can_refund);
      content.innerHTML=dataCenterTabs('data-center-payments')+
        '<div class="biz-kpi-grid">'+
          kpi('订单数',s.orderCount||0,'199 元诊断报告订单')+
          kpi('待付款',s.unpaidCount||0,'尚未进入正式诊断')+
          kpi('已完成结算',s.paidCount||0,'含正常付款与渠道优惠免付')+
          kpi('渠道免付',s.freeCount||0,'渠道权益免付订单')+
          kpi('付款转化率',((Number(s.paymentConversionRate||0)*100).toFixed(1))+'%','提交后完成付款')+
          kpi('退款处理中',s.refundProcessingCount||0,'等待微信支付结果')+
          kpi('部分退款',s.partiallyRefundedCount||0,'仍有部分金额未退')+
          kpi('已退款',s.refundedCount||0,'全额退款订单')+
          kpi('已关闭',s.closedCount||0,'客户取消或支付超时')+
          kpi('支付尝试',s.paymentAttemptCount||s.orderCount||0,'含重新支付记录')+
          kpi('累计实收',moneyFen(s.grossPaidAmount||0),'支付成功金额')+
          kpi('累计退款',moneyFen(s.refundedAmount||0),'退款成功金额')+
          kpi('净收款',moneyFen(s.netPaidAmount||0),'实收减已退款')+
        '</div><div style="height:14px"></div>'+
        '<section class="biz-card"><div class="biz-card-head"><div><h3>付款明细</h3><p>金额、付款状态、微信交易号与退款历史均来自真实支付订单。</p></div><button class="secondary-action" onclick="paymentStatistics()">刷新付款数据</button></div>'+
        '<div class="biz-card-body"><div class="table-scroll"><table class="business-table"><thead><tr><th>品牌 / 项目</th><th>订单号</th><th>金额</th><th>状态</th><th>微信交易号</th><th>创建 / 付款时间</th><th>可退款</th><th>操作</th></tr></thead><tbody>'+
        (items.map(row=>'<tr><td><strong>'+esc(row.brandName||'未命名品牌')+'</strong><br><small>'+esc(row.projectId||'—')+'</small></td><td><small>'+esc(row.outTradeNo||'—')+'</small></td><td>'+esc(moneyFen(row.amountTotal||0))+'</td><td>'+chip(paymentStatusLabel(row.status))+'</td><td><small>'+esc(row.transactionId||'—')+'</small></td><td><small>创建 '+esc(formatDate(row.createdAt))+'<br>付款 '+esc(formatDate(row.paidAt))+'</small></td><td>'+esc(moneyFen(row.refundableAmount||0))+'</td><td><div class="action-row"><button class="secondary-action compact" onclick="openPaymentDetail(\''+esc(row.outTradeNo||'')+'\')">详情</button>'+((canRefund&&['paid','partially_refunded'].includes(row.status)&&Number(row.refundableAmount||0)>0)?'<button class="primary-action compact" onclick="openPaymentRefund(\''+esc(row.outTradeNo||'')+'\')">退款</button>':'')+'</div></td></tr>').join('')||'<tr><td colspan="8">当前还没有付款订单。</td></tr>')+
        '</tbody></table></div></div></section>';
      window._paymentRows=items;window._paymentCanRefund=canRefund;
    }catch(e){
      content.innerHTML=dataCenterTabs('data-center-payments')+'<div class="notice danger">付款数据暂时无法读取：'+esc(String(e.message||e))+'</div>';
    }
  }
  window.paymentStatistics=paymentStatistics;
  window.openPaymentDetail=function(outTradeNo){
    const row=(window._paymentRows||[]).find(x=>String(x.outTradeNo)===String(outTradeNo));
    if(!row)return alert('没有找到该付款订单');
    const refunds=row.refunds||[];
    modal('付款详情','<div class="form-grid"><div class="field"><label>品牌</label><input value="'+esc(row.brandName||'')+'" disabled></div><div class="field"><label>客户编号</label><input value="'+esc(row.clientId||'—')+'" disabled></div><div class="field"><label>客户联系方式</label><input value="'+esc(customerContactDisplay(row.customerContactMasked))+'" disabled></div><div class="field"><label>产品</label><input value="'+esc(row.productName||'GeoGi 品牌 GEO 诊断报告')+'" disabled></div><div class="field"><label>项目编号</label><input value="'+esc(row.projectId||'')+'" disabled></div><div class="field"><label>提交编号</label><input value="'+esc(row.submissionId||'—')+'" disabled></div><div class="field full"><label>商户订单号</label><input value="'+esc(row.outTradeNo||'')+'" disabled></div><div class="field full"><label>微信支付交易号</label><input value="'+esc(row.transactionId||'未产生')+'" disabled></div><div class="field"><label>订单金额</label><input value="'+esc(moneyFen(row.amountTotal||0))+' '+esc(row.currency||'CNY')+'" disabled></div><div class="field"><label>付款状态</label><input value="'+esc(paymentStatusLabel(row.status))+'" disabled></div><div class="field"><label>微信交易状态</label><input value="'+esc(row.providerTradeState||'—')+'" disabled></div><div class="field"><label>付款时间</label><input value="'+esc(formatDate(row.paidAt))+'" disabled></div><div class="field"><label>创建时间</label><input value="'+esc(formatDate(row.createdAt))+'" disabled></div><div class="field"><label>支付有效期截止</label><input value="'+esc(formatDate(row.expiresAt))+'" disabled></div><div class="field"><label>关闭时间</label><input value="'+esc(formatDate(row.closedAt))+'" disabled></div><div class="field"><label>关闭原因</label><input value="'+esc(paymentCloseReasonLabel(row.closedReason))+'" disabled></div><div class="field"><label>最近更新</label><input value="'+esc(formatDate(row.updatedAt))+'" disabled></div><div class="field"><label>已退款</label><input value="'+esc(moneyFen(row.refundedAmount||0))+'" disabled></div><div class="field"><label>剩余可退款</label><input value="'+esc(moneyFen(row.refundableAmount||0))+'" disabled></div><div class="field full"><label>退款记录</label><div class="record-list">'+(refunds.length?refunds.map(x=>'<div class="record-item"><div><strong>'+esc(moneyFen(x.amount||0))+' · '+esc(paymentStatusLabel(x.status))+'</strong><p>'+esc(x.reason||'未填写退款原因')+'</p><small>商户退款号：'+esc(x.outRefundNo||'—')+'<br>微信退款号：'+esc(x.providerRefundId||'—')+'<br>申请：'+esc(formatDate(x.requestedAt))+' · 成功：'+esc(formatDate(x.successAt))+' · 操作人：'+esc(x.operatorId||'—')+'</small></div></div>').join(''):emptyBiz('暂无退款记录。'))+'</div></div><div class="form-actions"><button type="button" class="secondary" onclick="closeModal()">关闭</button></div></div>');
  };
  window.openPaymentRefund=function(outTradeNo){
    if(window._paymentCanRefund!==true)return alert('当前账号没有退款权限');
    const row=(window._paymentRows||[]).find(x=>String(x.outTradeNo)===String(outTradeNo));
    if(!row)return alert('没有找到该付款订单');
    const maxFen=Number(row.refundableAmount||0);
    modal('发起退款','<form id="paymentRefundForm" class="form-grid"><div class="field full"><label>订单</label><input value="'+esc((row.brandName||'')+' · '+row.outTradeNo)+'" disabled></div><div class="field"><label>可退款金额</label><input value="'+esc(moneyFen(maxFen))+'" disabled></div><div class="field"><label>本次退款金额（元）</label><input name="amount_yuan" type="number" min="0.01" step="0.01" max="'+esc((maxFen/100).toFixed(2))+'" value="'+esc((maxFen/100).toFixed(2))+'" required></div><div class="field full"><label>退款原因</label><textarea name="reason" rows="4" required placeholder="填写退款原因，便于后续核对"></textarea></div><div class="notice warn">退款提交后将调用微信支付退款接口。请确认订单和金额无误。</div><div class="form-actions"><button type="button" class="secondary" onclick="closeModal()">取消</button><button class="primary">确认退款</button></div></form>');
    document.getElementById('paymentRefundForm').onsubmit=async function(e){
      e.preventDefault();
      const fd=new FormData(e.target),amountYuan=Number(fd.get('amount_yuan')),amountFen=Math.round(amountYuan*100),reason=String(fd.get('reason')||'').trim();
      if(!reason)return alert('请填写退款原因');
      if(!amountFen||amountFen<1||amountFen>maxFen)return alert('退款金额无效');
      if(!confirm('确认向该客户退款 '+moneyFen(amountFen)+'？'))return;
      try{
        await api('/api/payments/'+encodeURIComponent(outTradeNo)+'/refund',{method:'POST',body:JSON.stringify({amount_fen:amountFen,reason})});
        closeModal();alert('退款请求已提交，请关注微信支付最终退款状态。');await paymentStatistics();
      }catch(err){alert(String(err.message||err))}
    };
  };

  function miniProgramUserTypeLabel(value){
    return {customer:'普通用户',staff:'内部人员',partner:'渠道合作方'}[String(value||'')]||'普通用户';
  }
  function miniProgramUserRelationText(row){
    const parts=[];
    if(Number(row?.customerCount||0)>0)parts.push('已成为客户');
    if((row?.channels||[]).length)parts.push('渠道负责人');
    if((row?.ownedSources||[]).length)parts.push('来源归属人');
    return parts.join(' · ')||'仅授权用户';
  }
  function miniProgramUserSearchText(row){
    return [
      row?.userId,row?.displayName,row?.phoneNumber,
      ...(row?.brandNames||[]),...(row?.clientIds||[]),...(row?.projectIds||[]),
      ...(row?.channels||[]).map(x=>x.name),...(row?.ownedSources||[]).map(x=>x.name)
    ].join(' ').toLowerCase();
  }
  function miniProgramUserRowsHtml(rows,canWrite){
    return (rows||[]).map(row=>{
      const channels=(row.channels||[]).map(x=>x.name).filter(Boolean);
      const sources=(row.ownedSources||[]).map(x=>x.name).filter(Boolean);
      return '<tr data-user-id="'+esc(row.userId||'')+'" data-search="'+esc(miniProgramUserSearchText(row))+'" data-user-type="'+esc(row.userType||'customer')+'" data-has-customer="'+(Number(row.customerCount||0)>0?'1':'0')+'" data-has-channel="'+(channels.length?'1':'0')+'" data-has-source="'+(sources.length?'1':'0')+'" data-channel-ids="'+esc((row.channels||[]).map(x=>x.channelId).join(','))+'">'+
        '<td><strong>'+esc(row.displayName||'未备注姓名')+'</strong><br><small>'+esc(row.userId||'—')+'</small></td>'+
        '<td>'+esc(row.phoneNumber||'—')+'<br><small>微信手机号已验证</small></td>'+
        '<td>'+esc(miniProgramUserTypeLabel(row.userType))+'<br><small>'+esc(miniProgramUserRelationText(row))+'</small></td>'+
        '<td>'+esc(row.customerCount||0)+' 个客户<br><small>'+esc((row.brandNames||[]).slice(0,2).join('、')||'暂无诊断客户')+'</small></td>'+
        '<td>'+esc(row.orderCount||0)+' / '+esc(row.paidOrderCount||0)+' / '+esc(row.reportCompletedCount||0)+'<br><small>订单 / 成交 / 报告完成</small></td>'+
        '<td>'+esc(channels.join('、')||'未绑定')+'</td>'+
        '<td>'+esc(sources.join('、')||'未绑定')+'</td>'+
        '<td>'+esc(formatDate(row.lastAuthorizedAt||row.latestOrderAt))+'</td>'+
        '<td><div class="action-row"><button class="secondary-action compact" onclick="openMiniProgramUserDetail(\''+esc(row.userId||'')+'\')">查看</button>'+(canWrite?'<button class="secondary-action compact" onclick="openMiniProgramUserEditor(\''+esc(row.userId||'')+'\')">设置</button>':'')+'</div></td>'+
      '</tr>';
    }).join('')||'<tr><td colspan="9">暂无符合条件的小程序用户。</td></tr>';
  }
  window.filterMiniProgramUsers=function(){
    const rows=window._miniProgramUsers||[],canWrite=window._miniProgramUserCanWrite===true;
    const q=String(document.getElementById('mpUserSearch')?.value||'').trim().toLowerCase();
    const type=String(document.getElementById('mpUserTypeFilter')?.value||'');
    const relation=String(document.getElementById('mpUserRelationFilter')?.value||'');
    const channelId=String(document.getElementById('mpUserChannelFilter')?.value||'');
    const filtered=rows.filter(row=>{
      if(q&&!miniProgramUserSearchText(row).includes(q))return false;
      if(type&&String(row.userType||'customer')!==type)return false;
      if(relation==='customer'&&Number(row.customerCount||0)<=0)return false;
      if(relation==='no-customer'&&Number(row.customerCount||0)>0)return false;
      if(relation==='channel'&&!(row.channels||[]).length)return false;
      if(relation==='source'&&!(row.ownedSources||[]).length)return false;
      if(relation==='authorization-only'&&(Number(row.customerCount||0)>0||(row.channels||[]).length||(row.ownedSources||[]).length))return false;
      if(channelId&&!(row.channels||[]).some(x=>String(x.channelId||'')===channelId))return false;
      return true;
    });
    const tbody=document.getElementById('mpUserRows');if(tbody)tbody.innerHTML=miniProgramUserRowsHtml(filtered,canWrite);
    const count=document.getElementById('mpUserResultCount');if(count)count.textContent=String(filtered.length);
  };
  window.filterMiniProgramUserOrders=function(){
    const q=String(document.getElementById('mpUserOrderSearch')?.value||'').trim().toLowerCase();
    const status=String(document.getElementById('mpUserOrderStatus')?.value||'');
    document.querySelectorAll('#mpUserOrderRows .mp-user-order-row').forEach(row=>{
      const show=(!q||String(row.dataset.search||'').includes(q))&&(!status||String(row.dataset.status||'')===status);
      row.style.display=show?'':'none';
    });
  };
  async function miniProgramUsers(){
    setBusinessTitle('小程序用户','查看微信手机号授权用户、客户记录、订单、来源归属与渠道关系。');
    try{
      const data=await api('/api/miniprogram-users');
      const users=data.users||[],channels=data.channels||[];
      window._miniProgramUsers=users;
      window._miniProgramUserChannels=channels;
      window._miniProgramUserCanWrite=Boolean(data.permissions&&data.permissions.can_write);
      const canWrite=window._miniProgramUserCanWrite;
      const withCustomer=users.filter(x=>Number(x.customerCount||0)>0).length;
      const channelOwners=users.filter(x=>(x.channels||[]).length>0).length;
      const sourceOwners=users.filter(x=>(x.ownedSources||[]).length>0).length;
      const paidUsers=users.filter(x=>Number(x.paidOrderCount||0)>0).length;
      const channelOptions=channels.map(x=>'<option value="'+esc(x.channelId)+'">'+esc(x.name||'未命名渠道')+'</option>').join('');
      content.innerHTML=
        '<div class="biz-kpi-grid">'+
          kpi('小程序用户',users.length,'已完成微信手机号授权')+
          kpi('已成为客户',withCustomer,'已有诊断客户记录')+
          kpi('有成交用户',paidUsers,'至少完成一笔成交')+
          kpi('渠道负责人',channelOwners,'已关联渠道')+
          kpi('来源归属人',sourceOwners,'已有个人来源入口')+
        '</div><div style="height:14px"></div>'+
        '<section class="biz-card"><div class="biz-card-head"><div><h3>小程序用户管理</h3><p>用户只来自微信手机号授权；可查看客户与订单情况，并为已验证用户配置渠道关系。</p></div><span class="badge blue">筛选结果 <b id="mpUserResultCount">'+esc(users.length)+'</b></span></div>'+
        '<div class="biz-card-body"><div class="toolbar" style="margin-bottom:12px;flex-wrap:wrap">'+
          '<input id="mpUserSearch" class="search" autocomplete="off" placeholder="搜索姓名 / 手机号 / 客户编号 / 品牌 / 项目" oninput="filterMiniProgramUsers()">'+
          '<select id="mpUserTypeFilter" onchange="filterMiniProgramUsers()"><option value="">全部用户类型</option><option value="customer">普通用户</option><option value="staff">内部人员</option><option value="partner">渠道合作方</option></select>'+
          '<select id="mpUserRelationFilter" onchange="filterMiniProgramUsers()"><option value="">全部关系</option><option value="customer">已成为客户</option><option value="no-customer">尚未提交诊断</option><option value="channel">渠道负责人</option><option value="source">来源归属人</option><option value="authorization-only">仅授权用户</option></select>'+
          '<select id="mpUserChannelFilter" onchange="filterMiniProgramUsers()"><option value="">全部渠道</option>'+channelOptions+'</select>'+
        '</div>'+
        '<div class="table-scroll"><table class="business-table"><thead><tr><th>用户</th><th>手机号</th><th>身份</th><th>客户情况</th><th>订单情况</th><th>渠道</th><th>来源</th><th>最近授权</th><th>操作</th></tr></thead><tbody id="mpUserRows">'+miniProgramUserRowsHtml(users,canWrite)+'</tbody></table></div></div></section>';
    }catch(e){content.innerHTML='<div class="notice danger">小程序用户暂时无法读取：'+esc(String(e.message||e))+'</div>'}
  }
  window.openMiniProgramUserDetail=function(userId){
    const row=(window._miniProgramUsers||[]).find(x=>String(x.userId)===String(userId));if(!row)return alert('没有找到该小程序用户');
    const customerRows=[];
    const seen=new Set();
    (row.orders||[]).forEach(order=>{const key=String(order.clientId||'')+'|'+String(order.projectId||'');if(!key||seen.has(key))return;seen.add(key);customerRows.push(order)});
    const orders=row.orders||[];
    modal('小程序用户详情',
      '<div class="form-grid">'+
        '<div class="field"><label>用户姓名 / 备注名</label><input value="'+esc(row.displayName||'未备注')+'" disabled></div>'+
        '<div class="field"><label>已验证手机号</label><input value="'+esc(row.phoneNumber||'')+'" disabled></div>'+
        '<div class="field"><label>用户类型</label><input value="'+esc(miniProgramUserTypeLabel(row.userType))+'" disabled></div>'+
        '<div class="field"><label>首次授权</label><input value="'+esc(formatDate(row.firstAuthorizedAt))+'" disabled></div>'+
        '<div class="field"><label>最近授权</label><input value="'+esc(formatDate(row.lastAuthorizedAt))+'" disabled></div>'+
        '<div class="field"><label>授权次数</label><input value="'+esc(row.authorizationCount||0)+'" disabled></div>'+
        '<div class="field full"><label>渠道关系</label><div class="record-list">'+((row.channels||[]).length?(row.channels||[]).map(x=>'<div class="record-item"><div><strong>'+esc(x.name||'渠道')+'</strong><p>'+esc(x.active?'生效中':'已停用')+'</p></div></div>').join(''):emptyBiz('未绑定渠道。'))+'</div></div>'+
        '<div class="field full"><label>来源归属</label><div class="record-list">'+((row.ownedSources||[]).length?(row.ownedSources||[]).map(x=>'<div class="record-item"><div><strong>'+esc(x.name||'来源')+'</strong><p>'+esc(sourceTypeLabel(x.sourceType))+' · '+esc(x.active?'生效中':'已停用')+'</p></div></div>').join(''):emptyBiz('未绑定来源入口。'))+'</div></div>'+
        '<div class="field full"><label>客户情况</label><div class="table-scroll"><table class="business-table"><thead><tr><th>品牌</th><th>客户编号</th><th>项目编号</th><th>最近状态</th></tr></thead><tbody>'+(customerRows.map(x=>'<tr><td><strong>'+esc(x.brandName||'未命名品牌')+'</strong></td><td>'+esc(x.clientId||'—')+'</td><td>'+esc(x.projectId||'—')+'</td><td>'+esc(paymentStatusLabel(x.status))+'</td></tr>').join('')||'<tr><td colspan="4">该用户尚未提交诊断。</td></tr>')+'</tbody></table></div></div>'+
        '<div class="field full"><label>订单情况</label><div class="toolbar" style="margin-bottom:10px;flex-wrap:wrap"><input id="mpUserOrderSearch" class="search" autocomplete="off" placeholder="搜索品牌 / 项目 / 来源 / 渠道" oninput="filterMiniProgramUserOrders()"><select id="mpUserOrderStatus" onchange="filterMiniProgramUserOrders()"><option value="">全部订单状态</option><option value="unpaid">待付款</option><option value="paying">付款确认中</option><option value="paid">已付款</option><option value="free">优惠免付</option><option value="refund_processing">退款处理中</option><option value="partially_refunded">部分退款</option><option value="refunded">已退款</option><option value="closed">已关闭</option></select></div><div class="table-scroll"><table class="business-table"><thead><tr><th>品牌 / 项目</th><th>来源</th><th>渠道</th><th>金额</th><th>退款</th><th>状态</th><th>报告</th><th>创建时间</th></tr></thead><tbody id="mpUserOrderRows">'+(orders.map(x=>'<tr class="mp-user-order-row" data-status="'+esc(x.status||'')+'" data-search="'+esc([x.brandName,x.projectId,x.clientId,x.sourceName,x.channelName,x.outTradeNo].join(' ').toLowerCase())+'"><td><strong>'+esc(x.brandName||'未命名品牌')+'</strong><br><small>'+esc(x.projectId||'—')+'</small></td><td>'+esc(x.sourceName||'直接访问')+'</td><td>'+esc(x.channelName||'—')+'</td><td>'+esc(channelMoney(x.amountYuan||0))+'</td><td>'+esc(channelMoney(x.refundedYuan||0))+'</td><td>'+esc(paymentStatusLabel(x.status))+'</td><td>'+esc(x.reportReleasedAt?'已完成':'未完成')+'</td><td>'+esc(formatDate(x.createdAt))+'</td></tr>').join('')||'<tr><td colspan="8">暂无订单。</td></tr>')+'</tbody></table></div></div>'+
        '<div class="field full"><label>运营备注</label><textarea rows="3" disabled>'+esc(row.notes||'')+'</textarea></div>'+
        '<div class="form-actions"><button type="button" class="secondary" onclick="closeModal()">关闭</button>'+(window._miniProgramUserCanWrite===true?'<button type="button" class="primary" onclick="closeModal();openMiniProgramUserEditor(\''+esc(row.userId||'')+'\')">设置用户</button>':'')+'</div>'+
      '</div>'
    );
  };
  window.openMiniProgramUserEditor=function(userId){
    if(window._miniProgramUserCanWrite!==true)return alert('当前账号没有用户管理权限');
    const row=(window._miniProgramUsers||[]).find(x=>String(x.userId)===String(userId));if(!row)return alert('没有找到该小程序用户');
    const channels=window._miniProgramUserChannels||[];
    const selected=(row.channels||[]).map(x=>String(x.channelId||''));
    modal('设置小程序用户',
      '<form id="miniProgramUserEditorForm" class="form-grid" autocomplete="off">'+
        '<div class="field"><label>微信已验证手机号</label><input value="'+esc(row.phoneNumber||'')+'" disabled><small>手机号来自微信授权，后台不可修改。</small></div>'+
        '<div class="field"><label>姓名 / 运营备注名</label><input name="display_name" autocomplete="off" value="'+esc(row.displayName||'')+'" placeholder="例如：廖华锋"></div>'+
        '<div class="field"><label>用户类型</label><select name="user_type"><option value="customer" '+(row.userType==='customer'?'selected':'')+'>普通用户</option><option value="staff" '+(row.userType==='staff'?'selected':'')+'>内部人员</option><option value="partner" '+(row.userType==='partner'?'selected':'')+'>渠道合作方</option></select></div>'+
        '<div class="field full"><label>设置渠道</label>'+channelCheckboxList(channels,selected)+'<small>勾选即关联，取消勾选即解除。这里只建立该用户与渠道的负责人关系，不会自动修改来源归属。</small></div>'+
        '<div class="field full"><label>运营备注</label><textarea name="notes" rows="3" placeholder="身份说明、合作约定等">'+esc(row.notes||'')+'</textarea></div>'+
        '<div class="notice">只有已经完成微信手机号授权的用户才会出现在这里。渠道与来源归属是两套独立关系。</div>'+
        '<div class="form-actions"><button type="button" class="secondary" onclick="closeModal()">取消</button><button class="primary">保存设置</button></div>'+
      '</form>'
    );
    document.getElementById('miniProgramUserEditorForm').onsubmit=async function(e){
      e.preventDefault();
      const fd=new FormData(e.target);
      const channelIds=[...e.target.querySelectorAll('input[name="channel_ids"]:checked')].map(x=>x.value).filter(Boolean);
      const payload={displayName:String(fd.get('display_name')||'').trim(),userType:String(fd.get('user_type')||'customer'),channelIds,notes:String(fd.get('notes')||'').trim()};
      try{
        await api('/api/miniprogram-users/'+encodeURIComponent(userId),{method:'POST',body:JSON.stringify(payload)});
        closeModal();await miniProgramUsers();
      }catch(err){alert(String(err.message||err))}
    };
  };

  function channelDiscountLabel(row){
    if(String(row?.discountType||'')==='free')return '本次免付';
    const fold=Number(row?.discountRateBps||10000)/1000;
    return (Number.isInteger(fold)?fold.toFixed(0):fold.toFixed(1))+' 折';
  }
  function channelCommissionLabel(row){
    const pct=Number(row?.commissionRateBps||0)/100;
    return pct>0?(Number.isInteger(pct)?pct.toFixed(0):pct.toFixed(2))+'%':'无返佣';
  }
  function channelLocalInput(value){
    if(!value)return '';const d=new Date(value);if(Number.isNaN(d.getTime()))return '';
    return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
  }
  function channelMoney(value){return '¥'+Number(value||0).toFixed(2)}

  function sourceTypeLabel(v){return {website:'官网',official_account:'公众号',business_card:'名片',channel:'渠道分享'}[String(v||'')]||String(v||'—')}
  function sourceStatusLabel(row){return row&&row.active!==false?'生效中':'已停用'}

  async function loadChannelCenterData(){
    const data=await api('/api/channels');
    const channels=data.channels||[],sources=data.sources||[],monthly=data.monthly||[],orders=data.orders||[],commissions=data.commissions||[],ownerStats=data.ownerStats||[],userOptions=data.userOptions||[];
    window._channelDashboard=data;
    window._channelRows=channels;
    window._sourceRows=sources;
    window._channelOrders=orders;
    window._channelCommissions=commissions;
    window._miniProgramUserOptions=userOptions;
    window._channelCanWrite=Boolean(data.permissions&&data.permissions.can_write);
    window._channelCanSettle=Boolean(data.permissions&&data.permissions.can_settle);
    return {data,channels,sources,monthly,orders,commissions,ownerStats,userOptions,canWrite:window._channelCanWrite,canSettle:window._channelCanSettle};
  }

  function channelCenterMetrics(channels,sources){
    return {
      activeChannels:channels.filter(x=>x.active).length,
      visits:sources.reduce((n,x)=>n+Number(x.visits||0),0),
      submissions:sources.reduce((n,x)=>n+Number(x.submittedOrders||0),0),
      deals:sources.reduce((n,x)=>n+Number(x.paidOrders||0),0),
      reports:sources.reduce((n,x)=>n+Number(x.completedReports||0),0),
      pending:channels.reduce((n,x)=>n+Number(x.pendingCommissionYuan||0),0),
      paid:channels.reduce((n,x)=>n+Number(x.paidCommissionYuan||0),0)
    };
  }

  async function channelOverview(){
    setTitle('渠道总览','渠道管理','查看渠道规模、来源流量、成交、报告交付和返佣状态。');
    try{
      const {channels,sources,ownerStats}=await loadChannelCenterData();
      const m=channelCenterMetrics(channels,sources);
      const conversion=m.submissions>0?((m.deals/m.submissions)*100).toFixed(1)+'%':'0.0%';
      content.innerHTML=
        '<div class="biz-kpi-grid">'+
          kpi('渠道数',channels.length,m.activeChannels+' 个生效中')+
          kpi('来源入口',sources.length,'官网、公众号、名片和渠道分享')+
          kpi('归属人员',ownerStats.length,'已绑定来源负责人')+
          kpi('来源访问',m.visits,'已记录进入小程序的来源访问')+
          kpi('诊断提交',m.submissions,'已完成资料提交')+
          kpi('成交订单',m.deals,'含正常付款与渠道优惠免付')+
          kpi('提交成交率',conversion,'成交订单 / 诊断提交')+
          kpi('报告完成',m.reports,'正式报告已发布')+
          kpi('待返佣',channelMoney(m.pending),'报告完成后待财务结算')+
          kpi('已返佣',channelMoney(m.paid),'财务已确认支付')+
        '</div><div style="height:14px"></div>'+
        '<div class="biz-grid-2">'+
          '<section class="biz-card"><div class="biz-card-head"><div><h3>渠道运营</h3><p>维护合作渠道、有效期、客户权益和返佣规则。</p></div><button class="primary-action" onclick="go(\'channel-manage\')">进入渠道管理</button></div><div class="biz-card-body">'+
            (channels.length?'<div class="record-list">'+channels.slice(0,6).map(row=>'<div class="record-item"><div><strong>'+esc(row.name||'未命名渠道')+'</strong><p>'+esc(channelDiscountLabel(row))+' · 返佣 '+esc(channelCommissionLabel(row))+'</p></div><span class="badge '+(row.active?'ok':'warn')+'">'+esc(row.active?'生效中':'已停用')+'</span></div>').join('')+'</div>':emptyBiz('当前还没有合作渠道。'))+
          '</div></section>'+
          '<section class="biz-card"><div class="biz-card-head"><div><h3>渠道数据</h3><p>查看来源入口表现、订单归因和月度返佣。</p></div><button class="secondary-action" onclick="go(\'channel-statistics\')">查看渠道统计</button></div><div class="biz-card-body">'+
            '<div class="record-groups"><div class="record-group"><div class="record-group-head"><strong>来源访问</strong><span>'+esc(m.visits)+'</span></div></div><div class="record-group"><div class="record-group-head"><strong>诊断提交</strong><span>'+esc(m.submissions)+'</span></div></div><div class="record-group"><div class="record-group-head"><strong>成交订单</strong><span>'+esc(m.deals)+'</span></div></div><div class="record-group"><div class="record-group-head"><strong>报告完成</strong><span>'+esc(m.reports)+'</span></div></div></div>'+
          '</div></section>'+
        '</div>';
    }catch(e){content.innerHTML='<div class="notice danger">渠道总览暂时无法读取：'+esc(String(e.message||e))+'</div>'}
  }

  async function refreshVerifiedUserOptions(){
    const data=await api('/api/miniprogram-users');
    const users=(data.users||[]).filter(x=>String(x.phoneNumber||'').trim());
    const options=users.map(x=>({
      userId:x.userId||'',
      phoneNumber:x.phoneNumber||'',
      displayName:x.displayName||'',
      userType:x.userType||'customer',
      lastAuthorizedAt:x.lastAuthorizedAt||'',
      verified:x.verified!==false
    }));
    window._miniProgramUserOptions=options;
    return options;
  }
  function userCheckboxList(name,users,selectedPhones,emptyText){
    const selected=new Set((selectedPhones||[]).map(String));
    if(!(users||[]).length)return '<div class="notice warn">'+esc(emptyText||'当前没有可选择的已验证小程序用户。')+'</div>';
    return '<div class="toolbar" style="margin-bottom:8px"><input class="search" autocomplete="off" placeholder="搜索姓名 / 手机号" oninput="filterInlineUserChoices(this)"></div>'+
      '<div class="record-list inline-user-choice-list">'+users.map(x=>{
        const label=verifiedUserOptionLabel(x);
        return '<label class="record-item inline-user-choice" data-search="'+esc(label.toLowerCase())+'" style="cursor:pointer;align-items:center"><div style="display:flex;align-items:center;gap:10px"><input type="checkbox" name="'+esc(name)+'" value="'+esc(x.phoneNumber||'')+'" '+(selected.has(String(x.phoneNumber||''))?'checked':'')+'><div><strong>'+esc(x.displayName||'未备注姓名')+'</strong><p>'+esc(x.phoneNumber||'—')+' · '+esc(miniProgramUserTypeLabel(x.userType))+'</p></div></div></label>';
      }).join('')+'</div>';
  }
  window.filterInlineUserChoices=function(input){
    const q=String(input?.value||'').trim().toLowerCase();
    const root=input?.closest('.field')||input?.parentElement?.parentElement;
    root?.querySelectorAll('.inline-user-choice').forEach(row=>row.style.display=(!q||String(row.dataset.search||'').includes(q))?'':'none');
  };
  function channelCheckboxList(channels,selectedIds){
    const selected=new Set((selectedIds||[]).map(String));
    if(!(channels||[]).length)return '<div class="notice">当前还没有可设置的渠道，请先在“渠道管理”中新建渠道。</div>';
    return '<div class="toolbar" style="margin-bottom:8px"><input class="search" autocomplete="off" placeholder="搜索渠道" oninput="filterInlineChannelChoices(this)"></div>'+
      '<div class="record-list inline-channel-choice-list">'+channels.map(x=>{
        const label=String(x.name||'未命名渠道');
        return '<label class="record-item inline-channel-choice" data-search="'+esc((label+' '+String(x.channelId||'')).toLowerCase())+'" style="cursor:pointer;align-items:center"><div style="display:flex;align-items:center;gap:10px"><input type="checkbox" name="channel_ids" value="'+esc(x.channelId||'')+'" '+(selected.has(String(x.channelId||''))?'checked':'')+'><div><strong>'+esc(label)+'</strong><p>'+esc(x.active===false?'已停用':'生效中')+'</p></div></div></label>';
      }).join('')+'</div>';
  }
  window.filterInlineChannelChoices=function(input){
    const q=String(input?.value||'').trim().toLowerCase();
    const root=input?.closest('.field')||input?.parentElement?.parentElement;
    root?.querySelectorAll('.inline-channel-choice').forEach(row=>row.style.display=(!q||String(row.dataset.search||'').includes(q))?'':'none');
  };

  function verifiedUserForPhone(phone){
    return (window._miniProgramUserOptions||[]).find(x=>String(x.phoneNumber||'')===String(phone||''))||null;
  }
  function verifiedUserOptionLabel(row){
    if(!row)return '';
    return (row.displayName||'未备注姓名')+' · '+(row.phoneNumber||'—')+' · '+miniProgramUserTypeLabel(row.userType);
  }
  function channelOwnerLabels(row){
    return (row?.ownerPhones||[]).map(phone=>{
      const user=verifiedUserForPhone(phone);
      return user?verifiedUserOptionLabel(user):String(phone||'')+'（历史未验证）';
    });
  }
  window.filterChannelManagementRows=function(){
    const q=String(document.getElementById('channelSearch')?.value||'').trim().toLowerCase();
    const status=String(document.getElementById('channelStatusFilter')?.value||'');
    const owner=String(document.getElementById('channelOwnerFilter')?.value||'');
    document.querySelectorAll('#channelManageRows .channel-manage-row').forEach(row=>{
      const show=(!q||String(row.dataset.search||'').includes(q))
        &&(!status||String(row.dataset.status||'')===status)
        &&(!owner||String(row.dataset.owners||'').split(',').includes(owner));
      row.style.display=show?'':'none';
    });
  };
  window.filterSourceManagementRows=function(){
    const q=String(document.getElementById('sourceSearch')?.value||'').trim().toLowerCase();
    const type=String(document.getElementById('sourceTypeFilter')?.value||'');
    const owner=String(document.getElementById('sourceOwnerFilter')?.value||'');
    const channel=String(document.getElementById('sourceChannelFilter')?.value||'');
    const status=String(document.getElementById('sourceStatusFilter')?.value||'');
    document.querySelectorAll('#sourceManageRows .source-manage-row').forEach(row=>{
      const show=(!q||String(row.dataset.search||'').includes(q))
        &&(!type||String(row.dataset.type||'')===type)
        &&(!owner||String(row.dataset.owner||'')===owner)
        &&(!channel||String(row.dataset.channel||'')===channel)
        &&(!status||String(row.dataset.status||'')===status);
      row.style.display=show?'':'none';
    });
  };

  async function channelManagement(){
    setTitle('渠道管理','渠道管理','维护渠道、有效期、客户权益、返佣规则、负责人和来源入口。');
    try{
      const {channels,sources,userOptions,canWrite}=await loadChannelCenterData();
      const ownerFilterOptions=userOptions.map(x=>'<option value="'+esc(x.phoneNumber||'')+'">'+esc(verifiedUserOptionLabel(x))+'</option>').join('');
      const channelFilterOptions=channels.map(x=>'<option value="'+esc(x.channelId||'')+'">'+esc(x.name||'未命名渠道')+'</option>').join('');
      const channelRows=channels.map(row=>{
        const ownerLabels=channelOwnerLabels(row);
        const search=[row.name,row.channelId,...ownerLabels].join(' ').toLowerCase();
        return '<tr class="channel-manage-row" data-search="'+esc(search)+'" data-status="'+esc(row.active?'active':'inactive')+'" data-owners="'+esc((row.ownerPhones||[]).join(','))+'">'+
          '<td><strong>'+esc(row.name||'未命名渠道')+'</strong><br><small>'+esc(row.channelId||'—')+'</small></td>'+
          '<td>'+esc(channelDiscountLabel(row))+'</td>'+
          '<td>'+esc(channelCommissionLabel(row))+'</td>'+
          '<td><small>'+esc(formatDate(row.startsAt))+'<br>至 '+esc(formatDate(row.endsAt))+'</small></td>'+
          '<td><small>'+esc(ownerLabels.join('、')||'未绑定')+'</small></td>'+
          '<td>'+esc(row.active?'生效中':'已停用')+'</td>'+
          '<td><div class="action-row"><button class="secondary-action compact" onclick="openChannelDetail(\''+esc(row.channelId||'')+'\')">明细</button>'+(canWrite?'<button class="secondary-action compact" onclick="openChannelEditor(\''+esc(row.channelId||'')+'\')">编辑</button>':'')+'</div></td>'+
        '</tr>';
      }).join('');
      const sourceRows=sources.map(row=>{
        const search=[row.name,row.sourceId,row.sourceTypeLabel||sourceTypeLabel(row.sourceType),row.ownerName,row.ownerPhone,row.channelName].join(' ').toLowerCase();
        return '<tr class="source-manage-row" data-search="'+esc(search)+'" data-type="'+esc(row.sourceType||'')+'" data-owner="'+esc(row.ownerPhone||'')+'" data-channel="'+esc(row.channelId||'')+'" data-status="'+esc(row.active!==false?'active':'inactive')+'">'+
          '<td><strong>'+esc(row.name||'未命名来源')+'</strong><br><small>'+esc(row.sourceId||'—')+'</small></td>'+
          '<td>'+esc(row.sourceTypeLabel||sourceTypeLabel(row.sourceType))+'</td>'+
          '<td>'+esc(row.ownerName||'未绑定')+(row.ownerPhone?'<br><small>'+esc(row.ownerPhone)+'</small>':'')+'</td>'+
          '<td>'+esc(row.channelName||'不绑定渠道')+'</td>'+
          '<td>'+esc(sourceStatusLabel(row))+'</td>'+
          '<td>'+esc(row.visits||0)+' / '+esc(row.submittedOrders||0)+' / '+esc(row.paidOrders||0)+'</td>'+
          '<td><small>'+esc(row.miniProgramPath||'—')+'</small><br>'+(row.codeUrl?'<a href="'+esc(row.codeUrl)+'" target="_blank" rel="noopener">查看小程序码</a>':'<small>尚未生成小程序码</small>')+'</td>'+
          '<td><div class="action-row">'+(canWrite?'<button class="secondary-action compact" onclick="openSourceEditor(\''+esc(row.sourceId||'')+'\')">编辑</button><button class="secondary-action compact" onclick="generateSourceCode(\''+esc(row.sourceId||'')+'\')">'+(row.codeUrl?'重新生成码':'生成小程序码')+'</button>':'—')+'</div></td>'+
        '</tr>';
      }).join('');
      content.innerHTML=
        '<section class="biz-card"><div class="biz-card-head"><div><h3>合作渠道</h3><p>客户无需输入任何渠道码。渠道负责人只能从已完成微信手机号授权的小程序用户中选择。</p></div>'+
          (canWrite?'<button class="primary-action" onclick="openChannelEditor()">新增渠道</button>':'')+
        '</div><div class="biz-card-body">'+
          '<div class="toolbar" style="margin-bottom:12px;flex-wrap:wrap"><input id="channelSearch" class="search" autocomplete="off" placeholder="搜索渠道 / 负责人 / 渠道 ID" oninput="filterChannelManagementRows()"><select id="channelStatusFilter" onchange="filterChannelManagementRows()"><option value="">全部状态</option><option value="active">生效中</option><option value="inactive">已停用</option></select><select id="channelOwnerFilter" onchange="filterChannelManagementRows()"><option value="">全部负责人</option>'+ownerFilterOptions+'</select></div>'+
          '<div class="table-scroll"><table class="business-table"><thead><tr><th>渠道</th><th>客户权益</th><th>返佣</th><th>有效期</th><th>负责人</th><th>状态</th><th>操作</th></tr></thead><tbody id="channelManageRows">'+(channelRows||'<tr><td colspan="7">当前还没有渠道。点击“新增渠道”设置客户权益与返佣规则。</td></tr>')+'</tbody></table></div></div></section><div style="height:14px"></div>'+
        '<section class="biz-card"><div class="biz-card-head"><div><h3>来源入口</h3><p>来源归属人只能选择已验证小程序用户；绑定渠道后才自动应用渠道客户权益和返佣规则。</p></div>'+
          (canWrite?'<button class="primary-action" onclick="openSourceEditor()">新增来源入口</button>':'')+
        '</div><div class="biz-card-body">'+
          '<div class="toolbar" style="margin-bottom:12px;flex-wrap:wrap"><input id="sourceSearch" class="search" autocomplete="off" placeholder="搜索来源 / 归属人 / 来源 ID" oninput="filterSourceManagementRows()"><select id="sourceTypeFilter" onchange="filterSourceManagementRows()"><option value="">全部类型</option><option value="website">官网</option><option value="official_account">公众号</option><option value="business_card">名片</option><option value="channel">渠道分享</option></select><select id="sourceOwnerFilter" onchange="filterSourceManagementRows()"><option value="">全部归属人</option>'+ownerFilterOptions+'</select><select id="sourceChannelFilter" onchange="filterSourceManagementRows()"><option value="">全部渠道</option>'+channelFilterOptions+'</select><select id="sourceStatusFilter" onchange="filterSourceManagementRows()"><option value="">全部状态</option><option value="active">生效中</option><option value="inactive">已停用</option></select></div>'+
          '<div class="table-scroll"><table class="business-table"><thead><tr><th>来源</th><th>类型</th><th>归属人</th><th>绑定渠道</th><th>状态</th><th>访问 / 提交 / 成交</th><th>小程序入口</th><th>操作</th></tr></thead><tbody id="sourceManageRows">'+(sourceRows||'<tr><td colspan="8">暂无来源入口。</td></tr>')+'</tbody></table></div></div></section>';
    }catch(e){content.innerHTML='<div class="notice danger">渠道管理暂时无法读取：'+esc(String(e.message||e))+'</div>'}
  }

  async function channelStatistics(){
    setTitle('渠道统计','渠道管理','查看来源表现、渠道订单、报告完成与月度返佣结算。');
    try{
      const {channels,sources,monthly,orders,ownerStats,canSettle}=await loadChannelCenterData();
      const m=channelCenterMetrics(channels,sources);
      content.innerHTML=
        '<div class="biz-kpi-grid">'+
          kpi('来源访问',m.visits,'所有来源入口访问')+
          kpi('诊断提交',m.submissions,'已归因提交')+
          kpi('成交订单',m.deals,'付款成功与渠道优惠免付')+
          kpi('报告完成',m.reports,'正式报告已发布')+
          kpi('待返佣',channelMoney(m.pending),'财务待结算')+
          kpi('已返佣',channelMoney(m.paid),'历史已支付')+
        '</div><div style="height:14px"></div>'+
        '<section class="biz-card"><div class="biz-card-head"><div><h3>人员归属统计</h3><p>按来源归属人统计访问、提交、成交和报告完成；人员归属与渠道优惠、返佣规则相互独立。</p></div></div><div class="biz-card-body"><div class="table-scroll"><table class="business-table"><thead><tr><th>归属人</th><th>绑定手机号</th><th>来源入口</th><th>访问</th><th>提交</th><th>成交</th><th>报告完成</th><th>实收</th></tr></thead><tbody>'+
        (ownerStats.map(row=>'<tr><td><strong>'+esc(row.ownerName||'未命名')+'</strong></td><td>'+esc(row.ownerPhone||'未绑定')+'</td><td>'+esc(row.sourceCount||0)+'</td><td>'+esc(row.visits||0)+'</td><td>'+esc(row.submittedOrders||0)+'</td><td>'+esc(row.paidOrders||0)+'</td><td>'+esc(row.completedReports||0)+'</td><td>'+esc(channelMoney(row.grossPaidYuan||0))+'</td></tr>').join('')||'<tr><td colspan="8">暂无已绑定归属人的来源。</td></tr>')+
        '</tbody></table></div></div></section><div style="height:14px"></div>'+
        '<section class="biz-card"><div class="biz-card-head"><div><h3>来源表现</h3><p>比较官网、公众号、名片和渠道分享的访问、提交与成交表现。</p></div></div><div class="biz-card-body"><div class="table-scroll"><table class="business-table"><thead><tr><th>来源</th><th>类型</th><th>归属人</th><th>绑定渠道</th><th>访问</th><th>提交</th><th>成交</th><th>报告完成</th><th>提交率</th><th>成交率</th></tr></thead><tbody>'+
        (sources.map(row=>{const visits=Number(row.visits||0),sub=Number(row.submittedOrders||0),paid=Number(row.paidOrders||0);return '<tr><td><strong>'+esc(row.name||'未命名来源')+'</strong></td><td>'+esc(row.sourceTypeLabel||sourceTypeLabel(row.sourceType))+'</td><td>'+esc(row.ownerName||'未绑定')+'</td><td>'+esc(row.channelName||'不绑定渠道')+'</td><td>'+esc(visits)+'</td><td>'+esc(sub)+'</td><td>'+esc(paid)+'</td><td>'+esc(row.completedReports||0)+'</td><td>'+esc(visits?((sub/visits)*100).toFixed(1)+'%':'0.0%')+'</td><td>'+esc(sub?((paid/sub)*100).toFixed(1)+'%':'0.0%')+'</td></tr>'}).join('')||'<tr><td colspan="10">暂无来源统计。</td></tr>')+
        '</tbody></table></div></div></section><div style="height:14px"></div>'+
        '<section class="biz-card"><div class="biz-card-head"><div><h3>渠道订单明细</h3><p>订单按首次有效来源归因；绑定渠道的来源自动应用渠道权益，并保留成交时规则快照。</p></div></div><div class="biz-card-body"><div class="table-scroll"><table class="business-table"><thead><tr><th>品牌 / 项目</th><th>来源</th><th>归属人</th><th>渠道</th><th>原价</th><th>成交金额</th><th>优惠</th><th>状态</th><th>报告</th></tr></thead><tbody>'+
        (orders.map(row=>'<tr><td><strong>'+esc(row.brandName||'未命名品牌')+'</strong><br><small>'+esc(row.projectId||'—')+'</small></td><td>'+esc(row.sourceName||'直接访问')+'<br><small>'+esc(sourceTypeLabel(row.sourceType))+'</small></td><td>'+esc(row.sourceOwnerName||'—')+'</td><td>'+esc(row.channelName||'—')+'</td><td>'+esc(channelMoney(row.listPriceYuan===undefined?199:row.listPriceYuan))+'</td><td><strong>'+esc(channelMoney(row.amountYuan||0))+'</strong></td><td>'+esc(channelMoney(row.discountYuan||0))+'</td><td>'+esc(paymentStatusLabel(row.status))+'</td><td>'+esc(row.reportReleasedAt?'已完成':'未完成')+'</td></tr>').join('')||'<tr><td colspan="9">当前还没有订单数据。</td></tr>')+
        '</tbody></table></div></div></section><div style="height:14px"></div>'+
        '<section class="biz-card"><div class="biz-card-head"><div><h3>月度返佣结算</h3><p>仅在诊断报告正式完成后产生返佣；财务线下支付后在此确认结算。</p></div></div><div class="biz-card-body"><div class="table-scroll"><table class="business-table"><thead><tr><th>月份</th><th>渠道</th><th>归因订单</th><th>成交订单</th><th>报告完成</th><th>实收</th><th>待返佣</th><th>已返佣</th><th>结算</th></tr></thead><tbody>'+
        (monthly.map(row=>'<tr><td>'+esc(row.period||'—')+'</td><td><strong>'+esc(row.channelName||'—')+'</strong></td><td>'+esc(row.orderCount||0)+'</td><td>'+esc(row.paidOrderCount||0)+'</td><td>'+esc(row.completedReportCount||0)+'</td><td>'+esc(channelMoney(row.grossPaidYuan))+'</td><td><strong>'+esc(channelMoney(row.pendingCommissionYuan))+'</strong></td><td>'+esc(channelMoney(row.paidCommissionYuan))+'</td><td>'+((canSettle&&Number(row.pendingCommissionYuan||0)>0)?'<button class="primary-action compact" onclick="openChannelSettlement(\''+esc(row.channelId||'')+'\',\''+esc(row.period||'')+'\')">确认已打款</button>':'—')+'</td></tr>').join('')||'<tr><td colspan="9">当前还没有月度返佣数据。</td></tr>')+
        '</tbody></table></div></div></section>';
    }catch(e){content.innerHTML='<div class="notice danger">渠道统计暂时无法读取：'+esc(String(e.message||e))+'</div>'}
  }
  window.channelOverview=channelOverview;
  window.channelManagement=channelManagement;
  window.channelStatistics=channelStatistics;

  window.openChannelDetail=function(channelId){
    const channel=(window._channelRows||[]).find(x=>String(x.channelId)===String(channelId));if(!channel)return alert('没有找到该渠道');
    const orders=(window._channelOrders||[]).filter(x=>String(x.channelId)===String(channelId));
    const commissions=(window._channelCommissions||[]).filter(x=>String(x.channelId)===String(channelId));
    const sources=(window._sourceRows||[]).filter(x=>String(x.channelId)===String(channelId));
    modal('渠道明细','<div class="form-grid"><div class="field"><label>渠道</label><input value="'+esc(channel.name||'')+'" disabled></div><div class="field"><label>客户权益</label><input value="'+esc(channelDiscountLabel(channel))+'" disabled></div><div class="field"><label>返佣比例</label><input value="'+esc(channelCommissionLabel(channel))+'" disabled></div><div class="field"><label>来源入口数</label><input value="'+esc(sources.length)+'" disabled></div><div class="field full"><label>渠道来源入口</label><div class="record-list">'+(sources.length?sources.map(x=>'<div class="record-item"><div><strong>'+esc(x.name||'来源')+' · '+esc(sourceTypeLabel(x.sourceType))+'</strong><p>'+esc(x.miniProgramPath||'')+'</p><small>访问 '+esc(x.visits||0)+' · 提交 '+esc(x.submittedOrders||0)+' · 成交 '+esc(x.paidOrders||0)+'</small></div></div>').join(''):emptyBiz('暂无渠道来源入口。'))+'</div></div><div class="field full"><label>渠道订单</label><div class="table-scroll"><table class="business-table"><thead><tr><th>品牌 / 项目</th><th>来源</th><th>成交金额</th><th>状态</th><th>时间</th></tr></thead><tbody>'+(orders.map(x=>'<tr><td><strong>'+esc(x.brandName||'未命名品牌')+'</strong><br><small>'+esc(x.projectId||'—')+'</small></td><td>'+esc(x.sourceName||'渠道分享')+'</td><td>'+esc(channelMoney(x.amountYuan||0))+'</td><td>'+esc(paymentStatusLabel(x.status))+'</td><td>'+esc(formatDate(x.createdAt))+'</td></tr>').join('')||'<tr><td colspan="5">暂无渠道订单</td></tr>')+'</tbody></table></div></div><div class="field full"><label>返佣明细</label><div class="table-scroll"><table class="business-table"><thead><tr><th>月份</th><th>项目</th><th>净实收</th><th>应返佣</th><th>已支付</th><th>状态</th></tr></thead><tbody>'+(commissions.map(x=>'<tr><td>'+esc(x.period||'—')+'</td><td>'+esc(x.brandName||x.projectId||'—')+'</td><td>'+esc(moneyFen(x.netPaidFen||0))+'</td><td>'+esc(moneyFen(x.earnedFen||0))+'</td><td>'+esc(moneyFen(x.payoutFen||0))+'</td><td>'+esc(x.payoutStatus||'—')+'</td></tr>').join('')||'<tr><td colspan="6">尚未产生返佣；报告完成后才会生成。</td></tr>')+'</tbody></table></div></div><div class="form-actions"><button type="button" class="secondary" onclick="closeModal()">关闭</button></div></div>');
  };

  window.openChannelEditor=async function(channelId=''){
    if(window._channelCanWrite!==true)return alert('当前账号没有渠道管理权限');
    let users=[];
    try{users=await refreshVerifiedUserOptions()}catch(err){return alert('已验证小程序用户读取失败：'+String(err.message||err))}
    const row=(window._channelRows||[]).find(x=>String(x.channelId)===String(channelId))||{};
    const fold=String(row.discountType||'percent')==='free'?'10':String(Number(row.discountRateBps||10000)/1000);
    const commissionPct=String(Number(row.commissionRateBps||0)/100);
    const ownerControl=userCheckboxList('owner_phones',users,row.ownerPhones||[],'当前没有可选择的已验证小程序用户。请让负责人先在小程序完成手机号授权，然后重新打开本窗口。');
    modal(channelId?('编辑渠道 · '+String(row.name||'未命名渠道')):'新增渠道',
      '<form id="channelEditorForm" class="form-grid" autocomplete="off"><input type="hidden" name="channel_id" value="'+esc(row.channelId||'')+'">'+
      '<div class="field"><label>渠道名称</label><input name="name" autocomplete="off" value="'+esc(row.name||'')+'" placeholder="例如：A 渠道" required></div>'+
      '<div class="field"><label>客户优惠类型</label><select name="discount_type"><option value="percent" '+(row.discountType!=='free'?'selected':'')+'>折扣</option><option value="free" '+(row.discountType==='free'?'selected':'')+'>本次诊断免费</option></select></div>'+
      '<div class="field"><label>客户折扣（折）</label><input name="discount_fold" type="number" min="0.1" max="10" step="0.1" value="'+esc(fold)+'"><small>例如 8 表示客户支付原价的 8 折；选择免费时此值忽略。</small></div>'+
      '<div class="field"><label>返佣比例（%）</label><input name="commission_percent" type="number" min="0" max="100" step="0.01" value="'+esc(commissionPct)+'"></div>'+
      '<div class="field"><label>状态</label><select name="active"><option value="true" '+(row.active!==false?'selected':'')+'>生效中</option><option value="false" '+(row.active===false?'selected':'')+'>停用</option></select></div>'+
      '<div class="field"><label>生效时间</label><input name="starts_at" type="datetime-local" value="'+esc(channelLocalInput(row.startsAt))+'"></div>'+
      '<div class="field"><label>失效时间</label><input name="ends_at" type="datetime-local" value="'+esc(channelLocalInput(row.endsAt))+'"></div>'+
      '<div class="field full"><label>渠道负责人</label>'+ownerControl+'<small>负责人选项每次打开都会实时读取“小程序用户”，不会使用旧缓存。</small></div>'+
      '<div class="field full"><label>备注</label><textarea name="notes" rows="3" placeholder="渠道说明、合作约定等">'+esc(row.notes||'')+'</textarea></div>'+
      '<div class="notice">渠道负责人只能从已验证小程序用户中选择。有效期和规则修改只影响之后创建的新订单，历史订单仍按成交时快照计算。</div>'+
      '<div class="form-actions"><button type="button" class="secondary" onclick="closeModal()">取消</button><button class="primary">保存渠道</button></div></form>'
    );
    document.getElementById('channelEditorForm').onsubmit=async function(e){
      e.preventDefault();
      const fd=new FormData(e.target),discountType=String(fd.get('discount_type')||'percent'),foldValue=Number(fd.get('discount_fold')||0),commissionPercent=Number(fd.get('commission_percent')||0);
      if(discountType==='percent'&&(!Number.isFinite(foldValue)||foldValue<=0||foldValue>10))return alert('折扣请输入 0.1–10 之间的数值，例如 8 表示 8 折');
      if(!Number.isFinite(commissionPercent)||commissionPercent<0||commissionPercent>100)return alert('返佣比例请输入 0–100 之间的百分比');
      const toIso=v=>{if(!v)return '';const d=new Date(String(v));return Number.isNaN(d.getTime())?'':d.toISOString()};
      const ownerPhones=[...e.target.querySelectorAll('input[name="owner_phones"]:checked')].map(x=>x.value).filter(Boolean);
      const payload={channelId:String(fd.get('channel_id')||''),name:String(fd.get('name')||'').trim(),discountType,discountRateBps:discountType==='free'?0:Math.round(foldValue*1000),commissionRateBps:Math.round(commissionPercent*100),active:String(fd.get('active'))==='true',startsAt:toIso(fd.get('starts_at')),endsAt:toIso(fd.get('ends_at')),ownerPhones,notes:String(fd.get('notes')||'').trim()};
      try{await api('/api/channels',{method:'POST',body:JSON.stringify(payload)});closeModal();await channelManagement()}catch(err){alert(String(err.message||err))}
    };
  };
  window.openSourceEditor=async function(sourceId=''){
    if(window._channelCanWrite!==true)return alert('当前账号没有来源管理权限');
    let users=[];
    try{users=await refreshVerifiedUserOptions()}catch(err){return alert('已验证小程序用户读取失败：'+String(err.message||err))}
    const row=(window._sourceRows||[]).find(x=>String(x.sourceId)===String(sourceId))||{};
    const channels=window._channelRows||[];
    const channelOptions='<option value="">不绑定渠道（官方来源）</option>'+channels.map(x=>'<option value="'+esc(x.channelId)+'" '+(String(row.channelId||'')===String(x.channelId)?'selected':'')+'>'+esc(x.name||'渠道')+'</option>').join('');
    const ownerChoices='<label class="record-item inline-user-choice" data-search="不绑定归属人" style="cursor:pointer;align-items:center"><div style="display:flex;align-items:center;gap:10px"><input type="radio" name="owner_phone" value="" '+(!row.ownerPhone?'checked':'')+'><div><strong>不绑定归属人</strong><p>适用于官网、公众号等不属于具体个人的来源。</p></div></div></label>'+users.map(x=>{const label=verifiedUserOptionLabel(x);return '<label class="record-item inline-user-choice" data-search="'+esc(label.toLowerCase())+'" style="cursor:pointer;align-items:center"><div style="display:flex;align-items:center;gap:10px"><input type="radio" name="owner_phone" value="'+esc(x.phoneNumber||'')+'" '+(String(row.ownerPhone||'')===String(x.phoneNumber||'')?'checked':'')+'><div><strong>'+esc(x.displayName||'未备注姓名')+'</strong><p>'+esc(x.phoneNumber||'—')+' · '+esc(miniProgramUserTypeLabel(x.userType))+'</p></div></div></label>'}).join('');
    modal(sourceId?'编辑来源入口':'新增来源入口',
      '<form id="sourceEditorForm" class="form-grid" autocomplete="off"><input type="hidden" name="source_id" value="'+esc(row.sourceId||'')+'">'+
      '<div class="field"><label>来源名称</label><input name="name" autocomplete="off" value="'+esc(row.name||'')+'" placeholder="例如：GeoGi 官网首页 / A 渠道商务名片" required></div>'+
      '<div class="field"><label>来源类型</label><select name="source_type"><option value="website" '+(row.sourceType==='website'?'selected':'')+'>官网</option><option value="official_account" '+(row.sourceType==='official_account'?'selected':'')+'>公众号</option><option value="business_card" '+(row.sourceType==='business_card'?'selected':'')+'>名片</option><option value="channel" '+(row.sourceType==='channel'?'selected':'')+'>渠道分享</option></select></div>'+
      '<div class="field full"><label>来源归属人</label><div class="toolbar" style="margin-bottom:8px"><input class="search" autocomplete="off" placeholder="搜索姓名 / 手机号" oninput="filterInlineUserChoices(this)"></div><div class="record-list inline-user-choice-list">'+ownerChoices+'</div><small>个人名片建议绑定对应小程序用户；官网、公众号等公共来源可以不绑定。保存时服务端会再次校验用户身份。</small></div>'+
      '<div class="field full"><label>绑定渠道</label><select name="channel_id">'+channelOptions+'</select><small>只有绑定渠道后，才自动应用该渠道的客户权益与返佣规则。</small></div>'+
      '<div class="field"><label>状态</label><select name="active"><option value="true" '+(row.active!==false?'selected':'')+'>生效中</option><option value="false" '+(row.active===false?'selected':'')+'>停用</option></select></div>'+
      '<div class="field"><label>生效时间</label><input name="starts_at" type="datetime-local" value="'+esc(channelLocalInput(row.startsAt))+'"></div>'+
      '<div class="field"><label>失效时间</label><input name="ends_at" type="datetime-local" value="'+esc(channelLocalInput(row.endsAt))+'"></div>'+
      '<div class="field full"><label>备注</label><textarea name="notes" rows="3" placeholder="例如：官网首页、2026版商务名片、渠道线下活动等">'+esc(row.notes||'')+'</textarea></div>'+
      '<div class="form-actions"><button type="button" class="secondary" onclick="closeModal()">取消</button><button class="primary">保存来源</button></div></form>'
    );
    document.getElementById('sourceEditorForm').onsubmit=async function(e){
      e.preventDefault();
      const fd=new FormData(e.target),sourceType=String(fd.get('source_type')||''),channelId=String(fd.get('channel_id')||''),ownerPhone=String(e.target.querySelector('input[name="owner_phone"]:checked')?.value||'');
      if(sourceType==='channel'&&!channelId)return alert('“渠道分享”类型必须绑定一个渠道');
      const user=users.find(x=>String(x.phoneNumber||'')===ownerPhone);
      const ownerName=user?.displayName||((ownerPhone&&String(row.ownerPhone||'')===ownerPhone)?String(row.ownerName||''):'');
      const toIso=v=>{if(!v)return '';const d=new Date(String(v));return Number.isNaN(d.getTime())?'':d.toISOString()};
      const payload={sourceId:String(fd.get('source_id')||''),name:String(fd.get('name')||'').trim(),sourceType,ownerName,ownerPhone,channelId,active:String(fd.get('active'))==='true',startsAt:toIso(fd.get('starts_at')),endsAt:toIso(fd.get('ends_at')),notes:String(fd.get('notes')||'').trim()};
      try{await api('/api/sources',{method:'POST',body:JSON.stringify(payload)});closeModal();await channelManagement()}catch(err){alert(String(err.message||err))}
    };
  };

  window.generateSourceCode=async function(sourceId){
    if(window._channelCanWrite!==true)return alert('当前账号没有来源管理权限');
    const row=(window._sourceRows||[]).find(x=>String(x.sourceId)===String(sourceId));
    if(!row)return alert('没有找到该来源入口');
    try{
      const result=await api('/api/sources/'+encodeURIComponent(sourceId)+'/miniprogram-code',{method:'POST',body:'{}'});
      await channelManagement();
      const url=result.codeUrl||'';
      if(url&&confirm('小程序码已生成。是否现在打开查看？'))window.open(url,'_blank','noopener');
    }catch(err){alert(String(err.message||err))}
  };

  window.openChannelSettlement=function(channelId,period){
    if(window._channelCanSettle!==true)return alert('当前账号没有返佣结算权限');
    const channel=(window._channelRows||[]).find(x=>String(x.channelId)===String(channelId));
    const month=((window._channelDashboard?.monthly)||[]).find(x=>String(x.channelId)===String(channelId)&&String(x.period)===String(period));
    if(!channel||!month)return alert('没有找到该月结算数据');
    modal('确认月度返佣已支付','<form id="channelSettlementForm" class="form-grid"><div class="field"><label>渠道</label><input value="'+esc(channel.name||'')+'" disabled></div><div class="field"><label>月份</label><input value="'+esc(period)+'" disabled></div><div class="field"><label>本次待返佣</label><input value="'+esc(channelMoney(month.pendingCommissionYuan))+'" disabled></div><div class="field full"><label>付款凭证 / 备注</label><textarea name="payout_reference" rows="3" required placeholder="例如：2026-09 月渠道返佣，银行转账流水号 / 财务备注"></textarea></div><div class="notice warn">请在财务已经线下完成付款后再确认。确认后该月待返佣会转为已返佣，并保留操作人和时间记录。</div><div class="form-actions"><button type="button" class="secondary" onclick="closeModal()">取消</button><button class="primary">确认已打款</button></div></form>');
    document.getElementById('channelSettlementForm').onsubmit=async function(e){e.preventDefault();const fd=new FormData(e.target),reference=String(fd.get('payout_reference')||'').trim();if(!reference)return alert('请填写付款凭证或财务备注');if(!confirm('确认 '+(channel.name||'渠道')+' '+period+' 的 '+channelMoney(month.pendingCommissionYuan)+' 返佣已完成线下支付？'))return;try{await api('/api/channels/'+encodeURIComponent(channelId)+'/settlements/'+encodeURIComponent(period),{method:'POST',body:JSON.stringify({payout_reference:reference})});closeModal();await channelStatistics()}catch(err){alert(String(err.message||err))}};
  };

  async function dataCenterAIPlatform(){
    if(!window.AIPlatformDaily?.view){setBusinessTitle('AI 平台监测','当前监测模块暂不可用。');content.innerHTML=dataCenterTabs('ai-platform-daily')+emptyBiz('AI 平台监测模块暂不可用。');return}
    await window.AIPlatformDaily.view();prependDataCenterTabs('ai-platform-daily');
  }
  async function dataCenterCompetitiveMonitoring(){
    if(typeof window.geoCompetitiveDailyView!=='function'){setBusinessTitle('竞品监测','当前竞品监测模块暂不可用。');content.innerHTML=dataCenterTabs('geo-competitive-daily')+emptyBiz('竞品监测模块暂不可用。');return}
    await window.geoCompetitiveDailyView();prependDataCenterTabs('geo-competitive-daily');
  }
  async function dataCenterCompetitiveDatabase(){
    if(typeof window.competitiveIntelligenceView!=='function'){setBusinessTitle('竞品数据库','当前竞品数据库暂不可用。');content.innerHTML=dataCenterTabs('competitive-intelligence')+emptyBiz('竞品数据库模块暂不可用。');return}
    await window.competitiveIntelligenceView();prependDataCenterTabs('competitive-intelligence');
  }

  async function businessIntakes(){
    setBusinessTitle('待接收客户','只处理已付款客户，以及付款功能上线前的历史免支付客户。');
    try{
      const [intakes,packs]=await Promise.all([api('/api/intakes'),api('/api/industry-packs')]);
      const industryPacks=packs.items||[];
      const items=(intakes.items||[]).filter(x=>{
        const stage=String(x.project?.stage||'PAYMENT_PENDING');
        return x.paymentEligibleForProcessing===true&&['PAYMENT_PENDING','INTAKE',''].includes(stage);
      });
      content.innerHTML=`<div class="split-title"><div><h3>待接收客户</h3><p>完成付款后进入这里；历史免支付客户按冻结规则保留。接收时先确认行业知识模板，再建立正式客户档案。</p></div><span class="queue-count">${items.length} 个待处理</span></div>${items.length?`<div class="record-groups">${items.map(x=>intakeCardBusiness(x,industryPacks)).join('')}</div>`:emptyBiz('当前没有待接收客户。')}`;
    }catch(e){content.innerHTML=`<div class="notice danger">待接收客户暂时无法读取：${esc(String(e.message||e))}</div>`}
  }
  function intakeCardBusiness(x,packs){
    const stage=x.project?.stage||'PAYMENT_PENDING',payment=x.payment||{},eligible=x.paymentEligibleForProcessing===true,
      legacy=x.paymentAdmissionMode==='legacy_pre_payment'&&x.legacyPaymentExemption?.eligible===true,
      accepted=!['PAYMENT_PENDING','REFUND_PROCESSING','REFUNDED','INTAKE',''].includes(String(stage)),
      options=packs.map(p=>`<option value="${esc(p.industry_pack_reference_id)}">${esc(p.pack_name)}${p.version?' · '+esc(p.version):''}</option>`).join('');
    const paymentPanel=legacy
      ? '<div class="profile-item"><span>接入方式</span><p>历史提交 · 免支付接入</p></div><div class="profile-item"><span>历史规则</span><p>付款功能上线前提交，不计入 ¥199 实收与付款转化。</p></div>'
      : '<div class="profile-item"><span>诊断报告订单</span><p>¥199 · '+esc(paymentStatusLabel(payment.status||'unpaid'))+'</p></div><div class="profile-item"><span>付款时间</span><p>'+esc(formatDate(payment.paidAt))+'</p></div>';
    let action='';
    if(accepted){
      action='<div class="notice">该客户已经进入正式运营流程，可在“客户管理”继续处理。</div>';
    }else if(!eligible){
      action='<div class="notice warn"><strong>'+(payment.status==='closed'?'支付订单已关闭':'等待客户支付 199 元')+'</strong><br>当前不能建立正式客户档案，也不会进入 GEO 诊断流程。</div>';
    }else{
      action='<div class="action-panel"><h4>建立正式客户档案</h4><p>'+(legacy?'该客户在付款功能上线前已提交资料，按历史客户迁移规则免支付接入。':'已确认客户付款。')+' 选择匹配的行业知识模板后接收客户，进入品牌企业研究与诊断流程。</p><div class="field"><label>行业知识模板</label><select id="pack-'+esc(x.projectId)+'">'+(options||'<option value="">暂无可用行业模板</option>')+'</select></div><div class="action-row"><button class="primary-action" '+(packs.length?'':'disabled')+' onclick="acceptIntakeBusiness(\''+esc(x.projectId)+'\')">接收并建立客户档案</button></div></div>';
    }
    const statusText=accepted?'已接收':legacy?'历史免支付':eligible?'已付款待接收':(payment.status==='closed'?'已关闭':'待付款');
    return '<section class="biz-card"><div class="biz-card-head"><div><h3>'+esc(x.brandName||'未命名客户')+'</h3><p>'+esc(x.industry||'行业待确认')+' · '+esc(x.segment||'细分待确认')+' · 提交于 '+esc(formatDate(x.submittedAt))+'</p></div>'+chip(statusText)+'</div><div class="biz-card-body"><div class="profile-grid"><div class="profile-item"><span>核心业务</span><p>'+esc(x.offerings||'未填写')+'</p></div><div class="profile-item"><span>目标客户</span><p>'+esc(x.audiences||'未填写')+'</p></div><div class="profile-item"><span>希望解决的问题</span><p>'+esc(x.goals||'未填写')+'</p></div><div class="profile-item"><span>主要优势 / 关注点</span><p>'+esc(x.advantages||'未填写')+'</p></div>'+paymentPanel+'</div><div style="height:12px"></div>'+action+'</div></section>';
  }
  window.acceptIntakeBusiness=async function(projectId){const pack=document.getElementById('pack-'+projectId)?.value||'';if(!pack)return alert('请先选择行业知识模板');try{await api('/api/intakes/'+encodeURIComponent(projectId)+'/accept',{method:'POST',body:JSON.stringify({industry_pack_reference_id:pack})});alert('客户资料已接收，并已建立正式客户档案。');if(state.view==='clients')await businessClients();else await businessIntakes()}catch(e){alert(String(e.message||e))}};

  function intakeBusinessStatus(row){
    const stage=String(row?.project?.stage||'PAYMENT_PENDING').toUpperCase();
    const paymentStatus=String(row?.payment?.status||'unpaid');
    const legacy=row?.paymentAdmissionMode==='legacy_pre_payment'&&row?.legacyPaymentExemption?.eligible===true;
    if(stage==='PAYMENT_PENDING'||stage==='INTAKE'||!stage){
      if(paymentStatus==='closed')return {label:'支付已关闭',className:'danger'};
      if(paymentStatus==='refunded')return {label:'已退款',className:'danger'};
      if(paymentStatus==='refund_processing')return {label:'退款处理中',className:'warn'};
      if(row?.paymentEligibleForProcessing===true)return {label:legacy?'历史免支付待接收':'已付款待接收',className:'warn'};
      return {label:'待付款',className:'warn'};
    }
    const map={
      ONBOARDING:'资料建档中',DETECTION:'AI 检测中',DIAGNOSIS:'诊断中',SOLUTION:'方案生成中',
      IMPLEMENTATION:'优化实施中',RETEST:'效果复测中',REVIEW:'报告审核中',RELEASED:'报告已交付',
      MONITORING:'持续服务',BLOCKED:'需要补充资料'
    };
    return {label:map[stage]||row?.currentStatus||statusLabel(stage),className:stage==='BLOCKED'?'danger':stage==='RELEASED'?'ok':'ok'};
  }

  function submittedCustomerSearchText(row){
    return [row.brandName,row.companyName,row.clientId,row.projectId,row.contactName,row.contactMethod,row.industry,row.segment,row.market,row.currentStatus]
      .map(v=>String(v||'').toLowerCase()).join(' ');
  }

  async function businessClients(){
    setBusinessTitle('全部客户','统一查看所有通过小程序提交的客户，并在这里完成查看资料、付款判断、接收和进入客户工作区。');
    const [intakesData,clientsData,packsData]=await Promise.all([api('/api/intakes'),api('/api/clients'),api('/api/industry-packs')]);
    const items=intakesData.items||[],clients=clientsData.items||[],industryPacks=packsData.items||[];
    const workspaces=await Promise.all(clients.map(async client=>{try{return await api('/api/clients/'+encodeURIComponent(client.client_id))}catch{return {client,records:{},projects:[],timeline:[]}}}));
    const workspaceByExternalProject=new Map();
    workspaces.forEach(d=>recordsOf(d,'customer_attachment').forEach(a=>{
      const externalProject=String(a.external_project_id||'');
      if(externalProject)workspaceByExternalProject.set(externalProject,d);
    }));
    const rows=items.map(row=>{
      const workspace=workspaceByExternalProject.get(String(row.projectId||''))||null;
      const businessStatus=intakeBusinessStatus(row);
      const payment=row.payment||{};
      const paymentText=row.paymentAdmissionMode==='legacy_pre_payment'?'历史免支付':paymentStatusLabel(payment.status||'unpaid');
      const actionButtons=[
        '<button class="secondary-action compact" onclick="openSubmittedCustomerDetail(\''+esc(row.projectId||'')+'\')">查看资料</button>'
      ];
      const stage=String(row.project?.stage||'PAYMENT_PENDING').toUpperCase();
      const actionable=row.paymentEligibleForProcessing===true&&['PAYMENT_PENDING','INTAKE',''].includes(stage);
      if(workspace?.client?.client_id){
        actionButtons.push('<button class="primary-action compact" onclick="openClient(\''+esc(workspace.client.client_id)+'\')">进入工作区</button>');
      }else if(actionable){
        actionButtons.push('<button class="primary-action compact" onclick="openSubmittedCustomerDetail(\''+esc(row.projectId||'')+'\',true)">接收客户</button>');
      }else if(['unpaid','paying','payment_failed','closed'].includes(String(payment.status||'unpaid'))){
        actionButtons.push('<button class="secondary-action compact" onclick="go(\'data-center-payments\')">查看付款</button>');
      }
      return '<tr class="submitted-customer-row" data-search="'+esc(submittedCustomerSearchText(row))+'">'+
        '<td><strong>'+esc(row.brandName||'未命名品牌')+'</strong><br><small>'+esc(row.companyName||'企业名称未填写')+'</small></td>'+
        '<td>'+esc(row.contactName||'—')+'<br><small>'+esc(customerContactDisplay(row.contactMethod))+'</small></td>'+
        '<td>'+esc(row.industry||'待确认')+'<br><small>'+esc(row.segment||'细分业务待确认')+'</small></td>'+
        '<td><small>'+esc(formatDate(row.submittedAt))+'</small></td>'+
        '<td>'+chip(paymentText)+'</td>'+
        '<td><span class="status-chip '+businessStatus.className+'">'+esc(businessStatus.label)+'</span></td>'+
        '<td><small>'+esc(row.projectId||'—')+'<br>'+esc(row.clientId||'—')+'</small></td>'+
        '<td><div class="action-row">'+actionButtons.join('')+'</div></td>'+
      '</tr>';
    }).join('');
    const paidWaiting=items.filter(x=>x.paymentEligibleForProcessing===true&&['PAYMENT_PENDING','INTAKE',''].includes(String(x.project?.stage||'PAYMENT_PENDING').toUpperCase())).length;
    const unpaid=items.filter(x=>!x.paymentEligibleForProcessing&&['unpaid','paying','payment_failed','closed'].includes(String(x.payment?.status||'unpaid'))).length;
    content.innerHTML='<div class="biz-kpi-grid submitted-customer-kpis">'+
      kpi('累计提交',items.length,'全部小程序客户提交')+
      kpi('待付款 / 已关闭',unpaid,'尚未进入正式诊断')+
      kpi('待接收',paidWaiting,'已付款或历史免支付')+
      kpi('已进入服务',Math.max(0,items.length-unpaid-paidWaiting),'已建立客户服务流程')+
      '</div><div style="height:14px"></div>'+
      '<div class="split-title"><div><h3>客户提交列表</h3><p>这里是客户总表，不只显示已接收客户。付款前、待接收、服务中和已交付客户都会保留。</p></div><div class="toolbar"><input id="businessClientSearch" class="search" placeholder="搜索品牌 / 企业 / 联系人 / 项目编号" oninput="filterBusinessClients()"><button class="secondary-action" onclick="go(\'intakes\')">只看待接收</button></div></div>'+
      '<section class="biz-card submitted-customer-table-card"><div class="biz-card-body"><div class="table-scroll"><table class="business-table submitted-customer-table"><thead><tr><th>品牌 / 企业</th><th>联系人 / 联系方式</th><th>行业 / 细分</th><th>提交时间</th><th>付款状态</th><th>业务状态</th><th>项目 / 客户编号</th><th>操作</th></tr></thead><tbody id="businessClientRows">'+(rows||'<tr><td colspan="8">当前还没有客户提交。</td></tr>')+'</tbody></table></div></div></section>';
    window._submittedCustomers=items;
    window._submittedCustomerPacks=industryPacks;
    window._submittedWorkspaceByProject=workspaceByExternalProject;
  }

  window.filterBusinessClients=function(){
    const q=(document.getElementById('businessClientSearch')?.value||'').toLowerCase();
    document.querySelectorAll('#businessClientRows .submitted-customer-row').forEach(r=>r.style.display=(r.dataset.search||'').includes(q)?'':'none');
  };

  window.openSubmittedCustomerDetail=function(projectId,focusAccept=false){
    const row=(window._submittedCustomers||[]).find(x=>String(x.projectId||'')===String(projectId||''));
    if(!row)return alert('没有找到该客户提交记录');
    const workspace=window._submittedWorkspaceByProject?.get(String(projectId||''))||null;
    const payment=row.payment||{},status=intakeBusinessStatus(row);
    const stage=String(row.project?.stage||'PAYMENT_PENDING').toUpperCase();
    const actionable=row.paymentEligibleForProcessing===true&&['PAYMENT_PENDING','INTAKE',''].includes(stage);
    const packs=window._submittedCustomerPacks||[];
    const legacy=row.paymentAdmissionMode==='legacy_pre_payment'&&row.legacyPaymentExemption?.eligible===true;
    let actions='';
    if(workspace?.client?.client_id){
      actions='<button type="button" class="primary" onclick="closeModal();openClient(\''+esc(workspace.client.client_id)+'\')">进入客户工作区</button>';
    }else if(actionable){
      const options=packs.map(p=>'<option value="'+esc(p.industry_pack_reference_id)+'">'+esc(p.pack_name)+(p.version?' · '+esc(p.version):'')+'</option>').join('');
      actions='<div class="field full"><label>行业知识模板</label><select id="all-customer-pack-'+esc(row.projectId)+'">'+(options||'<option value="">暂无可用行业模板</option>')+'</select><small>接收前确认模板是否与客户行业匹配。</small></div>'+
        '<button type="button" class="primary" '+(packs.length?'':'disabled')+' onclick="acceptSubmittedCustomer(\''+esc(row.projectId)+'\')">接收并建立客户档案</button>';
    }else{
      actions='<button type="button" class="secondary" onclick="closeModal();go(\'data-center-payments\')">查看付款记录</button>';
    }
    const paymentLabel=legacy?'历史提交 · 免支付接入':paymentStatusLabel(payment.status||'unpaid');
    modal('客户提交详情','<div class="form-grid submitted-customer-detail">'+
      '<div class="field"><label>品牌名称</label><input value="'+esc(row.brandName||'')+'" disabled></div>'+
      '<div class="field"><label>企业名称</label><input value="'+esc(row.companyName||'')+'" disabled></div>'+
      '<div class="field"><label>联系人</label><input value="'+esc(row.contactName||'—')+'" disabled></div>'+
      '<div class="field"><label>联系方式</label><input value="'+esc(row.contactMethod||'联系方式待同步')+'" disabled></div>'+
      '<div class="field"><label>行业</label><input value="'+esc(row.industry||'')+'" disabled></div>'+
      '<div class="field"><label>细分业务</label><input value="'+esc(row.segment||'')+'" disabled></div>'+
      '<div class="field"><label>主要市场</label><input value="'+esc(row.market||'')+'" disabled></div>'+
      '<div class="field"><label>提交时间</label><input value="'+esc(formatDate(row.submittedAt))+'" disabled></div>'+
      '<div class="field"><label>付款状态</label><input value="'+esc(paymentLabel)+'" disabled></div>'+
      '<div class="field"><label>业务状态</label><input value="'+esc(status.label)+'" disabled></div>'+
      '<div class="field full"><label>核心业务</label><textarea rows="3" disabled>'+esc(row.offerings||'未填写')+'</textarea></div>'+
      '<div class="field full"><label>主要客户</label><textarea rows="3" disabled>'+esc(row.audiences||'未填写')+'</textarea></div>'+
      '<div class="field full"><label>核心优势 / 关注点</label><textarea rows="3" disabled>'+esc(row.advantages||'未填写')+'</textarea></div>'+
      '<div class="field full"><label>竞品或对标品牌</label><textarea rows="2" disabled>'+esc(row.competitors||'未填写')+'</textarea></div>'+
      '<div class="field full"><label>诊断目标</label><textarea rows="2" disabled>'+esc(row.goals||'未填写')+'</textarea></div>'+
      '<div class="field full"><label>官网 / 官方渠道</label><input value="'+esc(row.officialChannel||'未填写')+'" disabled></div>'+
      '<div class="field"><label>项目编号</label><input value="'+esc(row.projectId||'')+'" disabled></div>'+
      '<div class="field"><label>客户编号</label><input value="'+esc(row.clientId||'')+'" disabled></div>'+
      '<div class="form-actions"><button type="button" class="secondary" onclick="closeModal()">关闭</button>'+actions+'</div>'+
      '</div>');
    if(focusAccept&&actionable)setTimeout(()=>document.getElementById('all-customer-pack-'+row.projectId)?.focus(),0);
  };

  window.acceptSubmittedCustomer=async function(projectId){
    const pack=document.getElementById('all-customer-pack-'+projectId)?.value||'';
    if(!pack)return alert('请先选择行业知识模板');
    if(!confirm('确认接收该客户并建立正式客户档案吗？'))return;
    try{
      await api('/api/intakes/'+encodeURIComponent(projectId)+'/accept',{method:'POST',body:JSON.stringify({industry_pack_reference_id:pack})});
      closeModal();
      alert('客户已接收，并已建立正式客户档案。');
      await businessClients();
    }catch(e){alert(String(e.message||e))}
  };

  async function businessClientWorkspace(id){
    const d=await api('/api/clients/'+encodeURIComponent(id));window._clientData=d;const stage=businessStage(d),c=d.client||{};const blocker=blockingCount(d),pending=pendingReviews(d);setBusinessTitle(displayName(d),`当前：${stage.label} · 流程完成 ${stage.progress}%`);
    content.innerHTML=`<div class="biz-card"><div class="biz-card-head"><div><h3>${esc(displayName(d))}</h3><p>${esc(latest(recordsOf(d,'customer_attachment'))?.business_profile?.industry||c.industry||'行业待完善')} · 负责人：${esc(c.service_owner||'未分配')}</p></div><div class="button-row">${blocker?`<span class="status-chip danger">${blocker} 个阻塞</span>`:''}${pending?`<span class="status-chip warn">${pending} 条待审核</span>`:''}<span class="status-chip ok">${dataCount(d)} 条数据</span></div></div><div class="biz-card-body"><div class="workflow-strip">${stage.rows.map((x,i)=>`<div class="workflow-step ${x.done?'done':''} ${i===stage.current?'current':''}"><div class="step-no">${x.done?'✓':i+1}</div><strong>${esc(x.label)}</strong><span>${x.done?'已有数据':i===stage.current?'当前步骤':'待开始'}</span></div>`).join('')}</div></div></div><div style="height:14px"></div>${nextActionPanel(d,stage)}<div class="workspace-tabs">${[['profile','客户资料'],['persona','目标客户画像'],['queries','检测问题与平台测试问题'],['capture','AI 检测数据'],['diagnosis','诊断与方案'],['execution','实施与复测'],['delivery','报告交付'],['history','操作记录']].map(([key,label])=>`<button class="${workspaceTab===key?'active':''}" onclick="switchBusinessTab('${key}')">${label}</button>`).join('')}</div><div id="businessWorkspaceBody">${workspaceTabHtml(d,workspaceTab)}</div>`;
  }
  window.switchBusinessTab=async function(tab){workspaceTab=tab;if(state.client)await businessClientWorkspace(state.client)};

  function nextActionPanel(d,stage){
    const clientId=canonicalClientId(d),projectId=projectIdFor(d);const querySet=latest(recordsOf(d,'query_set'));const plan=latest(recordsOf(d,'platform_test_plan'));const batch=latest(recordsOf(d,'observation_batch'));const fingerprint=latestFingerprint(d);const role=state.me?.role||'';
    if(!querySet){return `<div class="action-panel"><h4>下一步：生成检测方案与 12 条检测问题</h4><p>系统会基于客户提交的业务、受众、目标和行业信息生成客户画像、决策旅程、检测问题和平台测试问题候选。生成后必须先审核，后台不会直接启动 AI 检测。</p><div class="action-row"><button class="primary-action" onclick="prepareDetectionPlanBusiness('${esc(clientId)}','${esc(projectId)}')">生成检测方案</button></div></div><div style="height:14px"></div>`}
    if(String(querySet.review_status||'')==='pending_review'&&!plan){
      const reviewer=['geo_lead','qa_reviewer'].includes(role);return `<div class="action-panel"><h4>下一步：审核检测问题与平台测试问题</h4><p>12 条检测问题已经生成，当前仍是候选稿。审核通过后才会生成五个平台的正式平台测试问题 和检测批次。</p><div class="action-row">${reviewer?`<button class="primary-action" ${fingerprint?'':'disabled'} onclick="approveDetectionPlanBusiness('${esc(clientId)}','${esc(projectId)}','${esc(fingerprint)}')">审核通过并进入检测</button>`:`<button class="primary-action" onclick="requestQueryApprovalBusiness('${esc(clientId)}','${esc(projectId)}','${esc(querySet.query_set_id||querySet.object_id||'')}')">提交检测方案审核</button>`}<button class="secondary-action" onclick="switchBusinessTab('queries')">查看 12 条问题</button></div><div style="height:8px"></div><div class="notice">当前账号：${esc(roleLabel(role))}。${reviewer?'你拥有检测问题审核权限。':'正式审核必须由 GEO 负责人或质量审核角色完成，运营人员可以在后台发起审核待办。'}</div></div><div style="height:14px"></div>`}
    if(plan&&batch&&!recordsOf(d,'raw_answer').length){return `<div class="action-panel"><h4>下一步：开始 AI 平台检测</h4><p>检测问题和平台测试问题已审核，检测方案已经准备完成。启动后将进入真实 AI 平台执行，并把回答、引用和证据保存到本客户工作区。</p><div class="action-row"><button class="primary-action" onclick="runDetectionForClient('${esc(clientId)}','${esc(projectId)}','${esc(plan.platform_test_plan_id||plan.object_id||'')}','${esc(batch.observation_batch_id||batch.object_id||'')}')">开始正式检测</button><button class="secondary-action" onclick="switchBusinessTab('queries')">查看检测方案</button></div></div><div style="height:14px"></div>`}
    return `<div class="action-panel"><h4>当前步骤：${esc(stage.label)}</h4><p>请在下方对应业务页查看数据、待办和下一步操作；异常会统一进入“待办与异常”。</p></div><div style="height:14px"></div>`;
  }

  function latestFingerprint(d){const ev=[...(d.timeline||[])].sort((a,b)=>String(b.occurred_at||'').localeCompare(String(a.occurred_at||''))).find(x=>x.operation_type==='detection_plan_candidates_prepared');return ev?.details?.candidate_fingerprint||''}
  window.prepareDetectionPlanBusiness=async function(clientId,projectId){try{const r=await api('/api/clients/'+encodeURIComponent(clientId)+'/projects/prepare-detection-plan',{method:'POST',body:JSON.stringify({project_id:projectId})});alert(`检测方案已生成：${(r.query_candidates||[]).length} 条检测问题等待审核。`);workspaceTab='queries';await businessClientWorkspace(state.client)}catch(e){alert(String(e.message||e))}};
  window.requestQueryApprovalBusiness=async function(clientId,projectId,querySetId){try{await api('/api/interventions',{method:'POST',body:JSON.stringify({intervention_type:'queryset_approval',client_id:clientId,project_id:projectId,source_object_references:[querySetId],priority:'high',blocking:true,title:'审核客户检测问题与平台测试问题'})});alert('已创建检测方案审核待办。');await businessClientWorkspace(state.client)}catch(e){alert(String(e.message||e))}};
  window.approveDetectionPlanBusiness=async function(clientId,projectId,fingerprint){if(!fingerprint)return alert('未找到候选版本指纹，请重新生成候选方案后审核。');if(!confirm('确认这批检测问题与平台测试问题可以用于正式 AI 平台检测吗？'))return;try{const r=await api('/api/clients/'+encodeURIComponent(clientId)+'/projects/approve-detection-plan',{method:'POST',body:JSON.stringify({project_id:projectId,candidate_fingerprint:fingerprint})});alert(`检测方案已审核通过，已生成 ${r.prompt_instance_count||60} 条平台测试问题。`);await businessClientWorkspace(state.client)}catch(e){alert(String(e.message||e))}};

  function workspaceTabHtml(d,tab){if(tab==='profile')return profileTab(d);if(tab==='persona')return personaTab(d);if(tab==='queries')return queriesTab(d);if(tab==='capture')return captureTab(d);if(tab==='diagnosis')return diagnosisTab(d);if(tab==='execution')return executionTab(d);if(tab==='delivery')return deliveryTab(d);return historyTab(d)}
  function profileTab(d){const a=latest(recordsOf(d,'customer_attachment')),bp=a?.business_profile||{};const fields=[['品牌名称',bp.brandName],['企业名称',bp.companyName],['官网 / 官方渠道',bp.officialChannel],['市场范围',bp.market],['核心业务',bp.offerings],['目标客户',bp.audiences],['主要优势 / 关注点',bp.advantages],['竞争范围',bp.competitors],['本次目标',bp.goals],['客户附件',(bp.attachments||[]).join('\n')]];return `<section class="biz-card"><div class="biz-card-head"><div><h3>客户资料</h3><p>展示客户提交的原始资料，便于后续核验和补充。</p></div>${a?chip(a.assertion_status==='client_asserted'?'客户已提交':'active'):''}</div><div class="biz-card-body"><div class="profile-grid">${fields.map(([k,v])=>`<div class="profile-item"><span>${esc(k)}</span><p>${esc(v||'未填写')}</p></div>`).join('')}</div></div></section>`}
  function personaTab(d){const personas=recordsOf(d,'persona_graph'),journey=latest(recordsOf(d,'journey_graph'));return `<div class="biz-grid-2"><section class="biz-card"><div class="biz-card-head"><div><h3>目标客户画像</h3><p>用于理解不同决策角色的需求、比较重点和购买考虑。</p></div><span>${personas.length} 个画像</span></div><div class="biz-card-body">${personas.length?`<div class="persona-grid">${personas.map(p=>`<div class="persona-card"><h4>${esc(p.persona_name||'目标客户画像')}</h4><p>${esc(p.organization_context?.description||'')}</p><p><strong>主要目标：</strong>${esc((p.goals||[]).slice(0,2).join('；'))}</p><p><strong>关注点：</strong>${esc((p.decision_criteria||[]).slice(0,4).join('；'))}</p>${chip(p.review_status)}</div>`).join('')}</div>`:emptyBiz('尚未生成目标客户画像。')}</div></section><section class="biz-card"><div class="biz-card-head"><div><h3>客户决策旅程</h3><p>从需求触发到采购、实施和持续服务。</p></div></div><div class="biz-card-body">${journey?`<div class="journey-line">${(journey.journey_stages||[]).map(s=>`<div class="journey-node"><strong>${esc(journeyStageLabel(s.stage))}</strong><p>${esc(s.stage_goal||'')}</p></div>`).join('')}</div>`:emptyBiz('尚未生成客户决策旅程。')}</div></section></div>`}
  function journeyStageLabel(v){return {need_trigger:'需求触发',awareness:'了解类别',exploration:'寻找方案',comparison:'比较服务商',verification:'验证能力',decision:'采购决策',purchase:'确认购买',experience:'实施体验',advocacy_or_repurchase:'续费与推荐'}[v]||v}
  function queriesTab(d){const queries=recordsOf(d,'query'),prompts=recordsOf(d,'prompt_instance'),set=latest(recordsOf(d,'query_set')),plan=latest(recordsOf(d,'platform_test_plan')),batch=latest(recordsOf(d,'observation_batch'));const platformCounts={};prompts.forEach(p=>platformCounts[p.target_platform_id]=(platformCounts[p.target_platform_id]||0)+1);return `<section class="biz-card"><div class="biz-card-head"><div><h3>检测问题与平台测试问题</h3><p>查看检测问题、审核状态和各平台执行准备情况。</p></div>${set?chip(set.review_status):chip('draft')}</div><div class="biz-card-body">${queries.length?`<div class="query-list">${queries.map((q,i)=>`<div class="query-row"><div class="query-index">${i+1}</div><div><div class="query-text">${esc(q.query_text||'')}</div><div class="query-meta">${esc(journeyStageLabel(q.journey_stage||''))} · ${esc(q.query_intent||'')}</div></div><div>${chip(q.review_status)}</div></div>`).join('')}</div>`:emptyBiz('尚未生成检测问题。')}<div style="height:14px"></div><div class="biz-grid-3"><div class="profile-item"><span>检测问题</span><strong>${queries.length} 条</strong></div><div class="profile-item"><span>平台测试问题</span><strong>${prompts.length} 条</strong></div><div class="profile-item"><span>检测批次</span><strong>${batch?statusLabel(batch.batch_status||batch.lifecycle_status):'未生成'}</strong></div></div>${prompts.length?`<div style="height:14px"></div><div class="notice">平台测试问题分布：${Object.entries(platformCounts).map(([k,v])=>`${platformLabel(k)} ${v} 条`).join(' · ')}</div>`:''}${plan?`<div style="height:10px"></div><div class="notice">当前检测范围：${esc(plan.test_scope||'')}</div>`:''}</div></section>`}
  function platformLabel(v){return {doubao:'豆包',deepseek:'深度求索',tencent_yuanbao:'腾讯元宝',tongyi_qianwen:'通义千问',kimi:'月之暗面智能助手'}[v]||v}
  function captureTab(d){return recordSections(d,['platform_test_run','raw_answer','source_snapshot','citation','score_snapshot'],'AI 检测数据','这里保存真实平台检测得到的回答、信源、引用和评分。')}
  function diagnosisTab(d){return recordSections(d,['evaluation','score_snapshot','root_cause_finding','root_cause','opportunity','recommended_action','solution_package'],'诊断与优化方案','从真实检测数据形成问题定位、机会点和正式优化方案。')}
  function executionTab(d){return recordSections(d,['optimization_plan','action','action_execution_record','action_evidence','action_acceptance_review','retest_plan','retest_run','retest_comparison','outcome_assessment'],'实施与复测','每次实施动作、证据、验收和复测结果都在这里保留。')}
  function deliveryTab(d){return recordSections(d,['report','report_delivery_record','delivery_package'],'报告与交付','正式报告与客户交付记录集中管理。')}
  function recordSections(d,types,title,desc){const groups=types.map(t=>[t,recordsOf(d,t)]).filter(([,rows])=>rows.length);return `<section class="biz-card"><div class="biz-card-head"><div><h3>${esc(title)}</h3><p>${esc(desc)}</p></div></div><div class="biz-card-body">${groups.length?`<div class="record-groups">${groups.map(([t,rows])=>`<div class="record-group"><div class="record-group-head"><strong>${esc(TYPE_LABELS[t]||t)}</strong><span>${rows.length} 条</span></div><div class="record-list">${rows.slice(0,20).map(r=>`<div class="record-item"><strong>${esc(visibleSummary(r))}</strong><p>${esc(statusLabel(r.review_status||r.lifecycle_status||r.status||r.batch_status||''))} · ${esc(formatDate(r.updated_at||r.created_at||r.generated_at))}</p></div>`).join('')}</div></div>`).join('')}</div>`:emptyBiz('当前步骤还没有数据。')}</div></section>`}
  function historyTab(d){const rows=[...(d.timeline||[])].sort((a,b)=>String(b.occurred_at||'').localeCompare(String(a.occurred_at||'')));return `<section class="biz-card"><div class="biz-card-head"><div><h3>完整操作记录</h3><p>谁在什么时候做了什么、结果如何，都可以追溯。</p></div><span>${rows.length} 条记录</span></div><div class="biz-card-body">${rows.length?`<div class="timeline-business">${rows.map(r=>`<div class="timeline-business-row"><time>${esc(formatDate(r.occurred_at||r.created_at))}</time><strong>${esc(eventLabel(r.operation_type))}</strong><p>${esc(r.summary||statusLabel(r.result_status||''))}</p></div>`).join('')}</div>`:emptyBiz('暂无操作记录。')}</div></section>`}
  function eventLabel(v){return {miniprogram_intake_accepted:'客户资料已接收',detection_plan_candidates_prepared:'检测方案候选已生成',detection_plan_approved:'检测方案已审核',manual_intervention_created:'新增待办或异常',capture_dispatched:'AI 检测已启动',capture_completed:'AI 检测已完成',report_released:'正式报告已发布',workspace_created:'客户工作区已创建',profile_updated:'客户资料已更新'}[v]||String(v||'操作记录').replaceAll('_',' ')}

  async function businessInterventions(){setBusinessTitle('待办与异常','集中处理客户服务中的审核、异常和人工确认。');const allItems=(await api('/api/interventions')).items||[];const items=allItems.filter(x=>!['commercial_pricing','order_confirmation'].includes(String(x.intervention_type||'')));content.innerHTML=`<div class="split-title"><div><h3>需要人工处理的事项</h3><p>每个待办都会关联对应客户、项目和处理记录。</p></div></div>${items.length?`<div class="record-groups">${items.map(x=>`<section class="biz-card"><div class="biz-card-head"><div><h3>${esc(x.request_title||interventionLabel(x.intervention_type))}</h3><p>${esc(x.client_id||'')} · 创建于 ${esc(formatDate(x.created_at))}</p></div>${chip(x.status||'open')}</div><div class="biz-card-body"><div class="profile-grid"><div class="profile-item"><span>事项类型</span><strong>${esc(interventionLabel(x.intervention_type))}</strong></div><div class="profile-item"><span>优先级</span><strong>${esc(priorityLabel(x.priority))}</strong></div><div class="profile-item"><span>负责人</span><strong>${esc(x.assigned_to||'待分配')}</strong></div><div class="profile-item"><span>是否影响客户推进</span><strong>${x.blocking===false?'否':'是'}</strong></div></div>${!['approved','rejected','resolved','completed'].includes(String(x.status||''))?`<div style="height:12px"></div><div class="action-row"><button class="primary-action" onclick="decideTask('${esc(x.manual_intervention_task_id)}')">处理这个事项</button></div>`:''}</div></section>`).join('')}</div>`:emptyBiz('当前没有待办或异常。')}`}
  function interventionLabel(v){return {client_onboarding_review:'客户资料审核',baseline_approval:'检测基线审核',queryset_approval:'检测问题与平台测试问题审核',solution_approval:'优化方案审核',commercial_pricing:'报价审核',order_confirmation:'订单确认',publication_permission:'发布授权',execution_review:'实施审核',evidence_review:'实施证据审核',acceptance_review:'实施验收',retest_authorization:'复测授权',delivery_release:'报告发布审核',renewal_review:'续费评估',operational_exception:'运营异常处理'}[v]||v}
  function priorityLabel(v){return {urgent:'紧急',high:'高',medium:'中',low:'低'}[String(v||'').toLowerCase()]||text(v,'普通')}

  async function businessOrders(){if(typeof legacyOrders==='function'){await legacyOrders();setBusinessTitle('报告与交付','管理客户订单、方案实施、报告发布和正式交付。');translateVisibleTerms();return}content.innerHTML=emptyBiz('交付模块暂不可用。')}
  async function businessMonitoring(){if(typeof legacyMonitoring==='function'){await legacyMonitoring();setBusinessTitle('持续服务','安排持续监测、复测和下一轮优化。');translateVisibleTerms();return}content.innerHTML=emptyBiz('持续服务模块暂不可用。')}
  async function businessSystemStatus(){if(typeof legacySystemHealth==='function'){await legacySystemHealth();setBusinessTitle('系统状态','这里只用于查看后台链路是否可用，不要求运营人员理解技术实现。');translateVisibleTerms(true);return}content.innerHTML=emptyBiz('系统状态暂不可用。')}
  function translateVisibleTerms(systemOnly=false){
    const replacements=[['M01','客户建档'],['M03','检测方案'],['M04 Capture','AI 平台检测'],['M04','AI 平台检测'],['M07','优化实施'],['M09','报告交付'],['MiniProgram','小程序'],['PlatformTestPlan','检测方案'],['ObservationBatch','检测批次'],['PromptInstance','平台测试问题'],['SolutionPackage','优化方案'],['OptimizationPlan','实施计划'],['Action','实施任务'],['RetestPlan','复测计划'],['WorkflowInstance','交付流程记录'],['WorkflowDefinition','交付流程模板'],['Trusted Provider','报告发布服务'],['Canonical Client','正式客户档案'],['canonical','正式'],['Capture','AI 检测'],['not_configured','未配置'],['available','正常']];
    const walker=document.createTreeWalker(content,NodeFilter.SHOW_TEXT);const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);nodes.forEach(node=>{let value=node.nodeValue||'';replacements.forEach(([a,b])=>value=value.split(a).join(b));node.nodeValue=value});
    if(systemOnly){document.querySelectorAll('.integration-card strong').forEach(el=>{el.textContent=el.textContent.replace('小程序 Bridge','客户资料与小程序').replace('AI 平台检测','AI 平台检测').replace('实施','优化实施').replace('复测','效果复测').replace('交付','报告交付')})}
  }

  const originalShowApp=window.showApp;
  if(typeof originalShowApp==='function')window.showApp=function(){originalShowApp();const role=document.getElementById('operatorRole');if(role)role.textContent=roleLabel(state.me?.role)};

  setTimeout(()=>{document.body.classList.add('ops-business');const role=document.getElementById('operatorRole');if(role&&state.me)role.textContent=roleLabel(state.me.role)},0);
})();