앱 전체에서 overflow 문제를 찾아서 수정해줘.

[사전 분석 — 반드시 먼저 수행]
1. lib/ 하위 모든 dart 파일을 스캔
2. 각 화면/위젯에서 overflow 위험 요소 식별
3. 기존 코드 스타일 파악 (const 사용 여부, 들여쓰기 등)

[체크 항목]

1. **Text overflow**: 긴 텍스트가 잘리거나 넘치는 부분
   → `overflow: TextOverflow.ellipsis`, `maxLines`, `Flexible`, `Expanded` 적용

2. **Row overflow**: Row 내부 위젯이 화면 밖으로 넘치는 부분
   → `Flexible`, `Expanded`, `FittedBox` 적용

3. **Column overflow**: Column이 화면 높이를 초과하는 부분
   → `Expanded`, `Flexible`, `SingleChildScrollView` 적용

4. **BottomSheet overflow**: BottomSheet 내용이 화면 높이를 초과하는 부분
   → `maxHeight` 제약 + `SingleChildScrollView` 또는 `ListView` 스크롤 적용

5. **작은 화면 대응**: 숫자/퍼센트/가격 등이 작은 화면에서 넘치는 부분
   → `FittedBox(fit: BoxFit.scaleDown)` 적용

6. **SafeArea**: 모든 Scaffold에 SafeArea가 적용되어 있는지 확인

[수정 원칙]
- `Flexible` / `Expanded`를 우선 사용
- 텍스트는 `overflow: TextOverflow.ellipsis`와 `maxLines` 조합
- 숫자/가격 등 잘리면 안 되는 요소는 `FittedBox(fit: BoxFit.scaleDown)`
- BottomSheet는 반드시 `maxHeight` 제약 + 스크롤 가능하게
- 기존 코드 스타일 유지 (불필요한 변경 금지)

모든 lib/ 하위 dart 파일을 검사하고 overflow 위험 요소를 수정해줘.
